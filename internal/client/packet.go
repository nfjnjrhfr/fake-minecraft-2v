package client

import (
	"bufio"
	"context"
	"errors"
	"net"
	"sync"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/route"
)

// routedPacketSession carries datagrams for one SOCKS5 association.
//
// Routing is per destination, not per session: a single application often
// sends DNS to a local resolver and QUIC to a censored host over the same
// association. So the session keeps two outbound paths -- a tunnel and a plain
// local socket -- creates each one only if it is used, and merges their
// replies into one inbound queue.
type routedPacketSession struct {
	client *Client
	ctx    context.Context
	cancel context.CancelFunc

	mu     sync.Mutex
	tunnel *tunnelPackets
	direct net.PacketConn
	closed bool

	in   chan inbound
	once sync.Once
}

// inbound is one datagram waiting to be handed to the SOCKS layer.
type inbound struct {
	payload []byte
	addr    protocol.Addr
}

// inboundQueue bounds how many replies may wait before the SOCKS layer reads
// them. UDP is allowed to drop, and dropping is far better than growing a
// queue without limit when an application stops reading.
const inboundQueue = 256

func newRoutedPacketSession(ctx context.Context, c *Client) *routedPacketSession {
	ctx, cancel := context.WithCancel(ctx)
	return &routedPacketSession{
		client: c,
		ctx:    ctx,
		cancel: cancel,
		in:     make(chan inbound, inboundQueue),
	}
}

// WriteTo sends one datagram, choosing its path by routing rules.
func (s *routedPacketSession) WriteTo(p []byte, addr protocol.Addr) error {
	switch s.client.router.Match(addr.Hostname()) {
	case route.Block:
		logx.Debugf("block udp %s", addr)
		return nil // dropping is the UDP-shaped way to refuse
	case route.Direct:
		logx.Debugf("direct udp %s", addr)
		return s.writeDirect(p, addr)
	default:
		logx.Debugf("proxy  udp %s", addr)
		return s.writeTunnel(p, addr)
	}
}

// ReadFrom returns the next datagram from either path.
func (s *routedPacketSession) ReadFrom(buf []byte) (int, protocol.Addr, error) {
	select {
	case pkt, ok := <-s.in:
		if !ok {
			return 0, protocol.Addr{}, net.ErrClosed
		}
		n := copy(buf, pkt.payload)
		return n, pkt.addr, nil
	case <-s.ctx.Done():
		return 0, protocol.Addr{}, net.ErrClosed
	}
}

// Close ends the session and both of its paths.
func (s *routedPacketSession) Close() error {
	s.once.Do(func() {
		s.cancel()
		s.mu.Lock()
		s.closed = true
		tunnel, direct := s.tunnel, s.direct
		s.mu.Unlock()

		if tunnel != nil {
			tunnel.Close()
		}
		if direct != nil {
			direct.Close()
		}
	})
	return nil
}

// deliver queues an inbound datagram, dropping it if the consumer has fallen
// behind.
func (s *routedPacketSession) deliver(pkt inbound) {
	select {
	case s.in <- pkt:
	case <-s.ctx.Done():
	default:
		logx.Debugf("udp: inbound queue full, dropping packet from %s", pkt.addr)
	}
}

// writeTunnel sends through the veil server, opening the tunnel on first use.
func (s *routedPacketSession) writeTunnel(p []byte, addr protocol.Addr) error {
	t, err := s.getTunnel()
	if err != nil {
		return err
	}
	return t.WriteTo(p, addr)
}

func (s *routedPacketSession) getTunnel() (*tunnelPackets, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, net.ErrClosed
	}
	if s.tunnel != nil {
		t := s.tunnel
		s.mu.Unlock()
		return t, nil
	}
	s.mu.Unlock()

	// The UDP association's request carries no meaningful destination -- each
	// datagram names its own -- so a zero address stands in.
	conn, err := s.client.dialTunnel(s.ctx, protocol.Request{
		Command: protocol.CmdUDPAssociate,
		Target:  protocol.Addr{Type: protocol.AtypIPv4, IP: net.IPv4zero.To4()},
	})
	if err != nil {
		return nil, err
	}
	t := &tunnelPackets{conn: conn, br: bufio.NewReader(conn)}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		t.Close()
		return nil, net.ErrClosed
	}
	if s.tunnel != nil { // lost a race; keep the winner
		existing := s.tunnel
		s.mu.Unlock()
		t.Close()
		return existing, nil
	}
	s.tunnel = t
	s.mu.Unlock()

	go s.pumpTunnel(t)
	return t, nil
}

// pumpTunnel moves replies from the tunnel into the inbound queue.
func (s *routedPacketSession) pumpTunnel(t *tunnelPackets) {
	defer s.cancel()
	buf := make([]byte, protocol.MaxDatagram)
	for {
		n, addr, err := t.ReadFrom(buf)
		if err != nil {
			if s.ctx.Err() == nil && !errors.Is(err, net.ErrClosed) {
				logx.Debugf("udp: tunnel read: %v", err)
			}
			return
		}
		payload := make([]byte, n)
		copy(payload, buf[:n])
		s.deliver(inbound{payload: payload, addr: addr})
	}
}

// writeDirect sends from this machine, opening a local socket on first use.
func (s *routedPacketSession) writeDirect(p []byte, addr protocol.Addr) error {
	pc, err := s.getDirect()
	if err != nil {
		return err
	}
	// A direct destination has to be resolved here; there is no server to do
	// it for us on this path.
	dst, err := net.ResolveUDPAddr("udp", addr.String())
	if err != nil {
		logx.Debugf("udp: resolve %s: %v", addr, err)
		return nil
	}
	_, err = pc.WriteTo(p, dst)
	return err
}

func (s *routedPacketSession) getDirect() (net.PacketConn, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, net.ErrClosed
	}
	if s.direct != nil {
		pc := s.direct
		s.mu.Unlock()
		return pc, nil
	}
	s.mu.Unlock()

	pc, err := net.ListenPacket("udp", ":0")
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		pc.Close()
		return nil, net.ErrClosed
	}
	if s.direct != nil {
		existing := s.direct
		s.mu.Unlock()
		pc.Close()
		return existing, nil
	}
	s.direct = pc
	s.mu.Unlock()

	go s.pumpDirect(pc)
	return pc, nil
}

// pumpDirect moves replies from the local socket into the inbound queue.
func (s *routedPacketSession) pumpDirect(pc net.PacketConn) {
	buf := make([]byte, protocol.MaxDatagram)
	for {
		pc.SetReadDeadline(time.Now().Add(5 * time.Minute))
		n, from, err := pc.ReadFrom(buf)
		if err != nil {
			if s.ctx.Err() == nil {
				logx.Debugf("udp: direct read: %v", err)
			}
			return
		}
		addr, err := protocol.ParseAddr(from.String())
		if err != nil {
			continue
		}
		payload := make([]byte, n)
		copy(payload, buf[:n])
		s.deliver(inbound{payload: payload, addr: addr})
	}
}

// tunnelPackets frames datagrams over one tunnel stream.
type tunnelPackets struct {
	conn net.Conn
	br   *bufio.Reader

	writeMu sync.Mutex
	readMu  sync.Mutex
}

// WriteTo frames and sends one datagram. Writes are serialised because a
// stream has no record boundaries: two concurrent writers would interleave
// their frames and desynchronise the far end permanently.
func (t *tunnelPackets) WriteTo(p []byte, addr protocol.Addr) error {
	if len(p) > protocol.MaxDatagram {
		return protocol.ErrTooLarge
	}
	buf := protocol.Datagram{Addr: addr, Payload: p}.AppendTo(nil)

	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	_, err := t.conn.Write(buf)
	return err
}

// ReadFrom decodes the next datagram frame.
func (t *tunnelPackets) ReadFrom(buf []byte) (int, protocol.Addr, error) {
	t.readMu.Lock()
	defer t.readMu.Unlock()

	dgram, err := protocol.ReadDatagram(t.br, buf)
	if err != nil {
		return 0, protocol.Addr{}, err
	}
	return len(dgram.Payload), dgram.Addr, nil
}

// Close shuts the tunnel stream.
func (t *tunnelPackets) Close() error { return t.conn.Close() }

// compile-time check that the session satisfies the front end's interface.
var _ proxy.PacketSession = (*routedPacketSession)(nil)
