// Package relay moves bytes between two connections.
package relay

import (
	"errors"
	"io"
	"net"
	"sync"
	"syscall"
	"time"
)

// bufferSize is one TLS record's worth of plaintext plus room to spare, which
// keeps a copy loop from splitting records across syscalls.
const bufferSize = 32 * 1024

var pool = sync.Pool{New: func() any { b := make([]byte, bufferSize); return &b }}

// closeWriter is implemented by TCP and TLS connections, which can signal EOF
// in one direction while still reading in the other. Propagating that half
// close matters for protocols where the client signals "request finished" by
// shutting down its write side and then waits for the response.
type closeWriter interface{ CloseWrite() error }

// Pipe copies a<->b until both directions finish, then closes both.
//
// idle, when non-zero, is the maximum time either direction may stall before
// the pair is torn down. Without it, a proxy accumulates connections that a
// silently vanished peer will never close.
func Pipe(a, b net.Conn, idle time.Duration) error {
	if idle > 0 {
		a = &idleConn{Conn: a, idle: idle}
		b = &idleConn{Conn: b, idle: idle}
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)

	go func() { defer wg.Done(); errs[0] = copyAndSignal(b, a) }()
	go func() { defer wg.Done(); errs[1] = copyAndSignal(a, b) }()
	wg.Wait()

	a.Close()
	b.Close()

	for _, err := range errs {
		if err != nil && !isExpected(err) {
			return err
		}
	}
	return nil
}

// copyAndSignal copies src into dst and then half-closes dst so the far end
// sees a clean EOF rather than waiting for the whole pair to be torn down.
func copyAndSignal(dst, src net.Conn) error {
	buf := pool.Get().(*[]byte)
	defer pool.Put(buf)

	_, err := io.CopyBuffer(writerOnly{dst}, src, *buf)

	if cw, ok := dst.(closeWriter); ok {
		cw.CloseWrite()
	} else {
		dst.SetReadDeadline(time.Now())
	}
	return err
}

// writerOnly hides any ReadFrom method on dst so that io.CopyBuffer actually
// uses our pooled buffer instead of falling through to sendfile/splice, whose
// behaviour with our deadline-refreshing wrapper would be harder to reason
// about.
type writerOnly struct{ io.Writer }

// idleConn pushes the deadline forward on every successful operation, turning
// an absolute deadline into an inactivity timeout.
type idleConn struct {
	net.Conn
	idle time.Duration
	mu   sync.Mutex
	last time.Time
}

// touch refreshes the deadline, but only once per second of real time. Calling
// SetDeadline on every read of a fast download is a measurable cost for no
// benefit, since one second of slack on a minutes-long timeout is noise.
func (c *idleConn) touch() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if now.Sub(c.last) < time.Second {
		return
	}
	c.last = now
	c.Conn.SetDeadline(now.Add(c.idle))
}

func (c *idleConn) Read(b []byte) (int, error) {
	c.touch()
	n, err := c.Conn.Read(b)
	if n > 0 {
		c.touch()
	}
	return n, err
}

func (c *idleConn) Write(b []byte) (int, error) {
	c.touch()
	n, err := c.Conn.Write(b)
	if n > 0 {
		c.touch()
	}
	return n, err
}

// CloseWrite forwards the half close to the wrapped connection when it has one.
func (c *idleConn) CloseWrite() error {
	if cw, ok := c.Conn.(closeWriter); ok {
		return cw.CloseWrite()
	}
	return nil
}

// Unwrap exposes the underlying connection.
func (c *idleConn) Unwrap() net.Conn { return c.Conn }

// isExpected reports whether an error is just a connection ending normally.
// These are the overwhelming majority of "errors" a proxy sees and logging
// them at anything above debug buries the ones that matter.
func isExpected(err error) bool {
	switch {
	case err == nil,
		errors.Is(err, io.EOF),
		errors.Is(err, net.ErrClosed),
		errors.Is(err, io.ErrClosedPipe):
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	// Peer resets are routine: browsers abandon connections constantly.
	return errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EPIPE)
}
