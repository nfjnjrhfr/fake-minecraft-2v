package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/relay"
)

// SOCKS5 constants (RFC 1928).
const (
	socks5Version = 0x05

	methodNoAuth       = 0x00
	methodNoAcceptable = 0xff

	cmdConnect      = 0x01
	cmdBind         = 0x02
	cmdUDPAssociate = 0x03

	repSuccess         = 0x00
	repGeneralFailure  = 0x01
	repNotAllowed      = 0x02
	repNetworkUnreach  = 0x03
	repHostUnreachable = 0x04
	repRefused         = 0x05
	repCmdNotSupported = 0x07
)

// handleSOCKS5 serves one SOCKS5 client.
func (s *Server) handleSOCKS5(ctx context.Context, conn net.Conn) error {
	var ver [1]byte
	if _, err := io.ReadFull(conn, ver[:]); err != nil {
		return err
	}
	if ver[0] != socks5Version {
		return fmt.Errorf("socks: unsupported version %#x", ver[0])
	}
	if err := socksNegotiate(conn); err != nil {
		return err
	}

	head := make([]byte, 3)
	if _, err := io.ReadFull(conn, head); err != nil {
		return err
	}
	if head[0] != socks5Version {
		return fmt.Errorf("socks: unsupported version %#x", head[0])
	}
	target, err := protocol.ReadAddr(conn)
	if err != nil {
		socksReply(conn, repGeneralFailure, protocol.Addr{Type: protocol.AtypIPv4, IP: net.IPv4zero})
		return err
	}

	switch head[1] {
	case cmdConnect:
		return s.socksConnect(ctx, conn, target)
	case cmdUDPAssociate:
		if !s.udp {
			socksReply(conn, repCmdNotSupported, zeroAddr())
			return errors.New("socks: UDP association is disabled")
		}
		return s.socksUDP(ctx, conn)
	case cmdBind:
		socksReply(conn, repCmdNotSupported, zeroAddr())
		return errors.New("socks: BIND is not supported")
	default:
		socksReply(conn, repCmdNotSupported, zeroAddr())
		return fmt.Errorf("socks: unknown command %#x", head[1])
	}
}

// socksNegotiate performs the method-selection exchange. Only "no
// authentication" is offered: the listener is meant to sit on loopback, where
// a password would guard nothing that the OS is not already guarding.
func socksNegotiate(conn net.Conn) error {
	var n [1]byte
	if _, err := io.ReadFull(conn, n[:]); err != nil {
		return err
	}
	if n[0] == 0 {
		return errors.New("socks: client offered no auth methods")
	}
	methods := make([]byte, n[0])
	if _, err := io.ReadFull(conn, methods); err != nil {
		return err
	}
	for _, m := range methods {
		if m == methodNoAuth {
			_, err := conn.Write([]byte{socks5Version, methodNoAuth})
			return err
		}
	}
	conn.Write([]byte{socks5Version, methodNoAcceptable})
	return errors.New("socks: client requires authentication")
}

func (s *Server) socksConnect(ctx context.Context, conn net.Conn, target protocol.Addr) error {
	remote, err := s.dialer.Dial(ctx, target)
	if err != nil {
		socksReply(conn, replyCodeFor(err), zeroAddr())
		return fmt.Errorf("socks: connect %s: %w", target, err)
	}
	defer remote.Close()

	// The bound address in a successful reply is informational; clients use it
	// only for BIND. Reporting the local socket avoids disclosing the tunnel
	// server's address to every application on this machine.
	bound, _ := protocol.ParseAddr(conn.LocalAddr().String())
	if err := socksReply(conn, repSuccess, bound); err != nil {
		return err
	}
	return relay.Pipe(conn, remote, s.idle)
}

// socksUDP runs a UDP association.
//
// The TCP connection that requested the association is the association's
// lifetime: RFC 1928 requires the relay to be torn down when it closes, and
// that is also what stops a long-lived client from leaking sockets.
func (s *Server) socksUDP(ctx context.Context, conn net.Conn) error {
	host, _, err := net.SplitHostPort(conn.LocalAddr().String())
	if err != nil {
		socksReply(conn, repGeneralFailure, zeroAddr())
		return err
	}
	pc, err := net.ListenPacket("udp", net.JoinHostPort(host, "0"))
	if err != nil {
		socksReply(conn, repGeneralFailure, zeroAddr())
		return fmt.Errorf("socks: bind udp: %w", err)
	}
	defer pc.Close()

	session, err := s.dialer.DialPacket(ctx)
	if err != nil {
		socksReply(conn, repGeneralFailure, zeroAddr())
		return fmt.Errorf("socks: open udp session: %w", err)
	}
	defer session.Close()

	bound, err := protocol.ParseAddr(pc.LocalAddr().String())
	if err != nil {
		socksReply(conn, repGeneralFailure, zeroAddr())
		return err
	}
	if err := socksReply(conn, repSuccess, bound); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// The application's own datagram source address is not known until its
	// first packet arrives, and every packet after that must come from the
	// same place -- otherwise any process on the host could inject traffic
	// into the association. ready gates the downlink until we know it.
	var (
		clientAddr atomic.Value // net.Addr
		ready      = make(chan struct{})
		readyOnce  sync.Once
	)

	go func() {
		defer cancel()
		select {
		case <-ready:
		case <-ctx.Done():
			return
		}
		client, _ := clientAddr.Load().(net.Addr)

		buf := make([]byte, protocol.MaxDatagram)
		for {
			n, addr, err := session.ReadFrom(buf)
			if err != nil {
				return
			}
			out := make([]byte, 0, n+32)
			out = append(out, 0, 0, 0) // RSV RSV FRAG
			out = addr.AppendTo(out)
			out = append(out, buf[:n]...)
			if _, err := pc.WriteTo(out, client); err != nil {
				return
			}
		}
	}()

	// Closing the control connection is the client's way of ending the
	// association, so watch it and tear everything down when it goes.
	go func() {
		defer cancel()
		io.Copy(io.Discard, conn)
	}()
	go func() {
		<-ctx.Done()
		pc.Close()
		session.Close()
	}()

	buf := make([]byte, protocol.MaxDatagram)
	for {
		if s.idle > 0 {
			pc.SetReadDeadline(time.Now().Add(s.idle))
		}
		n, from, err := pc.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		if known, ok := clientAddr.Load().(net.Addr); !ok {
			clientAddr.Store(from)
			readyOnce.Do(func() { close(ready) })
		} else if known.String() != from.String() {
			logx.Debugf("socks: dropping udp packet from unexpected source %s", from)
			continue
		}

		dgram, err := parseSOCKSDatagram(buf[:n])
		if err != nil {
			logx.Debugf("socks: %v", err)
			continue
		}
		if err := session.WriteTo(dgram.Payload, dgram.Addr); err != nil {
			return err
		}
	}
}

// parseSOCKSDatagram decodes the RSV/FRAG/address header wrapping every
// datagram an application sends to the association.
func parseSOCKSDatagram(b []byte) (protocol.Datagram, error) {
	if len(b) < 5 {
		return protocol.Datagram{}, errors.New("udp datagram too short")
	}
	if b[2] != 0 {
		// Fragmentation is optional in RFC 1928 and no real client uses it.
		return protocol.Datagram{}, errors.New("fragmented udp datagrams are not supported")
	}
	r := newByteReader(b[3:])
	addr, err := protocol.ReadAddr(r)
	if err != nil {
		return protocol.Datagram{}, err
	}
	return protocol.Datagram{Addr: addr, Payload: r.rest()}, nil
}

// socksReply writes a reply record.
func socksReply(conn net.Conn, code byte, bound protocol.Addr) error {
	if bound.Type == 0 {
		bound = zeroAddr()
	}
	buf := []byte{socks5Version, code, 0x00}
	buf = bound.AppendTo(buf)
	_, err := conn.Write(buf)
	return err
}

func zeroAddr() protocol.Addr {
	return protocol.Addr{Type: protocol.AtypIPv4, IP: net.IPv4zero.To4()}
}

// replyCodeFor maps a dial failure onto the closest SOCKS status, so that a
// client can distinguish "you may not go there" from "it did not answer".
func replyCodeFor(err error) byte {
	var blocked *ErrBlocked
	if errors.As(err, &blocked) {
		return repNotAllowed
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return repHostUnreachable
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return repHostUnreachable
	}
	var oe *net.OpError
	if errors.As(err, &oe) {
		if _, ok := oe.Err.(*net.DNSError); ok {
			return repHostUnreachable
		}
		return repRefused
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return repHostUnreachable
	}
	if errors.Is(err, net.ErrClosed) {
		return repNetworkUnreach
	}
	return repGeneralFailure
}

// byteReader lets the address decoder run over an in-memory datagram while
// still reporting how much it consumed.
type byteReader struct {
	b []byte
	i int
}

func newByteReader(b []byte) *byteReader { return &byteReader{b: b} }

func (r *byteReader) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}

func (r *byteReader) rest() []byte { return r.b[r.i:] }
