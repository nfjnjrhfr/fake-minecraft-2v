package server

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/route"
)

// udpSessionTimeout ends an association that has moved no datagrams. UDP has
// no close, so a timer is the only way to reclaim the socket.
const udpSessionTimeout = 2 * time.Minute

// handleUDP serves a UDP association: datagram frames arrive on the tunnel
// stream, go out over one shared local socket, and replies come back framed
// the same way.
func (s *Server) handleUDP(ctx context.Context, conn net.Conn, user string) error {
	pc, err := net.ListenPacket("udp", ":0")
	if err != nil {
		return fmt.Errorf("bind udp: %w", err)
	}
	defer pc.Close()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	logx.Debugf("server: %s opened udp association on %s", user, pc.LocalAddr())

	var (
		writeMu sync.Mutex
		// seen records the destinations this association has actually sent to.
		// Replies from anywhere else are discarded: an unconnected socket will
		// happily accept datagrams from any host on the internet, and
		// forwarding those into the tunnel would let a third party inject
		// traffic into the user's session.
		seen   = make(map[string]time.Time)
		seenMu sync.Mutex
	)

	touch := func(host string) {
		seenMu.Lock()
		seen[host] = time.Now()
		seenMu.Unlock()
	}
	known := func(host string) bool {
		seenMu.Lock()
		defer seenMu.Unlock()
		t, ok := seen[host]
		return ok && time.Since(t) < udpSessionTimeout
	}

	// Downlink: local socket -> tunnel.
	go func() {
		defer cancel()
		buf := make([]byte, protocol.MaxDatagram)
		out := make([]byte, 0, protocol.MaxDatagram+32)
		for {
			pc.SetReadDeadline(time.Now().Add(udpSessionTimeout))
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			host, _, splitErr := net.SplitHostPort(from.String())
			if splitErr != nil || !known(host) {
				logx.Debugf("server: dropping udp reply from unsolicited host %s", from)
				continue
			}
			addr, err := protocol.ParseAddr(from.String())
			if err != nil {
				continue
			}

			out = protocol.Datagram{Addr: addr, Payload: buf[:n]}.AppendTo(out[:0])
			writeMu.Lock()
			_, err = conn.Write(out)
			writeMu.Unlock()
			if err != nil {
				return
			}
		}
	}()

	go func() {
		<-ctx.Done()
		pc.Close()
		conn.Close()
	}()

	// Uplink: tunnel -> local socket.
	br := bufio.NewReader(conn)
	buf := make([]byte, protocol.MaxDatagram)
	for {
		conn.SetReadDeadline(time.Now().Add(udpSessionTimeout))
		dgram, err := protocol.ReadDatagram(br, buf)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}

		dst, err := net.ResolveUDPAddr("udp", dgram.Addr.String())
		if err != nil {
			logx.Debugf("server: resolve %s: %v", dgram.Addr, err)
			continue
		}
		if !s.cfg.AllowPrivate && route.IsPrivateHost(dst.IP) {
			logx.Debugf("server: refusing udp to private address %s", dst)
			continue
		}

		touch(dst.IP.String())
		if _, err := pc.WriteTo(dgram.Payload, dst); err != nil {
			logx.Debugf("server: udp write to %s: %v", dst, err)
		}
	}
}
