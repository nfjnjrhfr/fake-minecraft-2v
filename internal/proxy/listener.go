package proxy

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
)

// Server accepts local connections and serves both SOCKS5 and HTTP on the same
// port. One port for both means the user configures a single "127.0.0.1:1080"
// everywhere, whether the application in question speaks SOCKS or HTTP.
type Server struct {
	dialer Dialer
	idle   time.Duration
	udp    bool

	wg sync.WaitGroup
}

// Options configure a Server.
type Options struct {
	// IdleTimeout tears down relays that have carried no data for this long.
	IdleTimeout time.Duration

	// UDP enables SOCKS5 UDP association.
	UDP bool
}

// New creates a local proxy server that dials through d.
func New(d Dialer, opts Options) *Server {
	return &Server{dialer: d, idle: opts.IdleTimeout, udp: opts.UDP}
}

// Serve accepts connections until ctx is cancelled or ln fails.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			// A per-connection accept error (out of file descriptors, for
			// instance) should not kill a proxy that is otherwise working.
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			return fmt.Errorf("proxy: accept: %w", err)
		}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.serveConn(ctx, conn)
		}()
	}

	s.wg.Wait()
	return nil
}

// serveConn identifies the protocol and dispatches.
func (s *Server) serveConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	if tc, ok := conn.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
	}

	br := bufio.NewReader(conn)
	buffered := &bufferedConn{Conn: conn, r: br}

	// Give the application a bounded window to say what it wants; a connection
	// that opens and says nothing must not occupy a slot forever.
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	head, err := br.Peek(1)
	if err != nil {
		return
	}
	conn.SetReadDeadline(time.Time{})

	switch head[0] {
	case socks5Version:
		err = s.handleSOCKS5(ctx, buffered)
	case 0x04:
		// SOCKS4 cannot carry a domain name in its original form, which would
		// force local DNS resolution for every destination.
		err = errors.New("proxy: SOCKS4 is not supported, use SOCKS5")
	default:
		err = s.handleHTTP(ctx, buffered, br)
	}
	if err != nil && logx.Enabled(logx.LevelDebug) {
		logx.Debugf("proxy: %v", err)
	}
}

// bufferedConn presents a net.Conn whose reads come from a bufio.Reader, so
// that bytes peeked during protocol detection are not lost.
type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.r.Read(p) }

// CloseWrite forwards the half close so relayed connections still signal EOF.
func (c *bufferedConn) CloseWrite() error {
	if cw, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return cw.CloseWrite()
	}
	return nil
}
