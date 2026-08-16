// Package proxy implements the local entry points an application talks to:
// SOCKS5 and HTTP, both served on one port and told apart by their first byte.
package proxy

import (
	"context"
	"net"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
)

// Dialer is the outbound side of the client: given a destination it decides,
// by routing rules, whether to open a tunnelled or a direct connection.
type Dialer interface {
	// Dial opens a stream to target. The address is passed through unresolved
	// so that a domain name can be sent to the far end for resolution there.
	Dial(ctx context.Context, target protocol.Addr) (net.Conn, error)

	// DialPacket opens a session carrying datagrams for SOCKS5 UDP association.
	DialPacket(ctx context.Context) (PacketSession, error)
}

// PacketSession carries UDP datagrams to arbitrary destinations.
type PacketSession interface {
	// WriteTo sends one datagram to addr.
	WriteTo(p []byte, addr protocol.Addr) error

	// ReadFrom receives one datagram into buf, reporting where it came from.
	ReadFrom(buf []byte) (n int, addr protocol.Addr, err error)

	// Close ends the session.
	Close() error
}

// ErrBlocked is returned by a Dialer when routing rules refuse a destination.
// The front ends translate it into the protocol's own "forbidden" status
// rather than a generic failure, so a blocked request looks different from a
// broken one in the browser.
type ErrBlocked struct{ Host string }

func (e *ErrBlocked) Error() string { return "blocked by routing rules: " + e.Host }
