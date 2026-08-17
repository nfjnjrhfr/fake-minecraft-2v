// Package protocol implements the veil wire format.
//
// A veil session is a normal TLS 1.3 connection to the server's :443. Once the
// TLS handshake completes the client immediately writes:
//
//	+------------+------+-----+------+------+------+--------+---------+------+
//	| auth (64B) | CRLF | cmd | atyp | addr | port | padlen | padding | CRLF |
//	+------------+------+-----+------+------+------+--------+---------+------+
//
// followed by the payload. The server replies with nothing at all: the first
// bytes it sends back are genuine payload from the target. A failed request is
// signalled by closing the connection.
//
// Two properties matter for censorship resistance, and both come from that
// layout. Nothing precedes the TLS ClientHello, so on the wire a session is
// byte-for-byte an HTTPS session. And the auth token is the very first thing
// inside the tunnel, so a server that does not recognise it can hand the whole
// connection to a real web server before writing a single byte of its own --
// an active prober sees an ordinary website, not a proxy that rejected it.
package protocol

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
)

// AuthLen is the length in bytes of the hex-encoded authentication token.
const AuthLen = 64

// MaxPadding bounds the random padding appended to a request header. Padding
// exists so that the first client record does not have a length that depends
// only on the destination address, which would otherwise leak a little about
// where the user is going and make all veil handshakes look alike.
const MaxPadding = 255

// Commands.
const (
	CmdConnect      byte = 0x01 // stream a TCP connection to the target
	CmdUDPAssociate byte = 0x03 // carry datagrams over this stream
)

// Address types, deliberately identical to SOCKS5 so that addresses can be
// moved between the local SOCKS listener and the tunnel without re-encoding.
const (
	AtypIPv4   byte = 0x01
	AtypDomain byte = 0x03
	AtypIPv6   byte = 0x04
)

var crlf = []byte{'\r', '\n'}

// Errors returned when parsing a peer's frames. They are deliberately vague to
// the caller: the server must never let a prober distinguish "bad password"
// from "malformed header" by timing or behaviour, so both lead to the same
// fallback path.
var (
	ErrBadAuth   = errors.New("veil: authentication failed")
	ErrBadHeader = errors.New("veil: malformed request header")
	ErrBadAddr   = errors.New("veil: malformed address")
	ErrTooLarge  = errors.New("veil: frame exceeds maximum size")
)

// MaxDatagram is the largest UDP payload carried in one tunnelled frame. It is
// comfortably above any path MTU while keeping a single frame bounded.
const MaxDatagram = 65507

// Token derives the wire authentication token from a password. The domain
// separation prefix keeps the value from colliding with a bare SHA-256 of the
// same password that might exist in some unrelated credential database.
func Token(password string) []byte {
	sum := sha256.Sum256([]byte("veil-auth-v1|" + password))
	out := make([]byte, AuthLen)
	hex.Encode(out, sum[:])
	return out
}

// TokenEqual compares two tokens in constant time.
func TokenEqual(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// Addr is a destination: either a resolved IP or a domain name that the server
// should resolve itself. Deferring resolution to the server is what keeps DNS
// queries off the local network, where they are the easiest thing to censor.
type Addr struct {
	Type byte
	IP   net.IP
	Host string
	Port uint16
}

// ParseAddr builds an Addr from a "host:port" string.
func ParseAddr(hostport string) (Addr, error) {
	host, portStr, err := net.SplitHostPort(hostport)
	if err != nil {
		return Addr{}, fmt.Errorf("%w: %v", ErrBadAddr, err)
	}
	port, err := strconv.ParseUint(portStr, 10, 16)
	if err != nil {
		return Addr{}, fmt.Errorf("%w: bad port %q", ErrBadAddr, portStr)
	}
	a := Addr{Port: uint16(port)}
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			a.Type, a.IP = AtypIPv4, v4
		} else {
			a.Type, a.IP = AtypIPv6, ip.To16()
		}
		return a, nil
	}
	if host == "" || len(host) > 255 {
		return Addr{}, fmt.Errorf("%w: bad domain length", ErrBadAddr)
	}
	a.Type, a.Host = AtypDomain, host
	return a, nil
}

// String renders the address in "host:port" form, ready for net.Dial.
func (a Addr) String() string {
	port := strconv.Itoa(int(a.Port))
	if a.Type == AtypDomain {
		return net.JoinHostPort(a.Host, port)
	}
	return net.JoinHostPort(a.IP.String(), port)
}

// Hostname returns just the host portion, without the port.
func (a Addr) Hostname() string {
	if a.Type == AtypDomain {
		return a.Host
	}
	return a.IP.String()
}

// AppendTo encodes the address in SOCKS5 form.
func (a Addr) AppendTo(b []byte) []byte {
	switch a.Type {
	case AtypIPv4:
		b = append(b, AtypIPv4)
		b = append(b, a.IP.To4()...)
	case AtypIPv6:
		b = append(b, AtypIPv6)
		b = append(b, a.IP.To16()...)
	case AtypDomain:
		b = append(b, AtypDomain, byte(len(a.Host)))
		b = append(b, a.Host...)
	}
	return binary.BigEndian.AppendUint16(b, a.Port)
}

// ReadAddr decodes a SOCKS5-form address from r.
func ReadAddr(r io.Reader) (Addr, error) {
	var head [1]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return Addr{}, err
	}
	var a Addr
	a.Type = head[0]
	switch a.Type {
	case AtypIPv4:
		buf := make([]byte, 4)
		if _, err := io.ReadFull(r, buf); err != nil {
			return Addr{}, err
		}
		a.IP = net.IP(buf)
	case AtypIPv6:
		buf := make([]byte, 16)
		if _, err := io.ReadFull(r, buf); err != nil {
			return Addr{}, err
		}
		a.IP = net.IP(buf)
	case AtypDomain:
		var l [1]byte
		if _, err := io.ReadFull(r, l[:]); err != nil {
			return Addr{}, err
		}
		if l[0] == 0 {
			return Addr{}, ErrBadAddr
		}
		buf := make([]byte, l[0])
		if _, err := io.ReadFull(r, buf); err != nil {
			return Addr{}, err
		}
		a.Host = string(buf)
	default:
		return Addr{}, ErrBadAddr
	}
	var port [2]byte
	if _, err := io.ReadFull(r, port[:]); err != nil {
		return Addr{}, err
	}
	a.Port = binary.BigEndian.Uint16(port[:])
	return a, nil
}

// Request is the first frame a client sends inside the tunnel.
type Request struct {
	Command byte
	Target  Addr
}

// EncodeRequest serialises a request, including the auth token and a random
// amount of padding.
func EncodeRequest(token []byte, req Request) ([]byte, error) {
	if len(token) != AuthLen {
		return nil, ErrBadAuth
	}
	var padLen [1]byte
	if _, err := rand.Read(padLen[:]); err != nil {
		return nil, err
	}
	pad := make([]byte, padLen[0])
	if _, err := rand.Read(pad); err != nil {
		return nil, err
	}

	buf := make([]byte, 0, AuthLen+2+2+259+2+int(padLen[0])+2)
	buf = append(buf, token...)
	buf = append(buf, crlf...)
	buf = append(buf, req.Command)
	buf = req.Target.AppendTo(buf)
	buf = append(buf, padLen[0])
	buf = append(buf, pad...)
	buf = append(buf, crlf...)
	return buf, nil
}

// ReadAuth reads exactly the auth token and its trailing CRLF.
//
// It returns whatever it managed to consume alongside the error. That
// "consumed" slice is what makes probe resistance work: the server replays it
// verbatim into the fallback web server so a mistaken client -- or a prober
// speaking plain HTTP -- gets a real response rather than a dropped
// connection.
func ReadAuth(r io.Reader) (token, consumed []byte, err error) {
	buf := make([]byte, AuthLen+2)
	n := 0
	for n < len(buf) {
		m, rerr := r.Read(buf[n:])
		if m > 0 {
			// Bail out the moment the bytes cannot be a veil header, instead of
			// waiting for the full 66. A veil token is hex, so its only newline
			// is the one that terminates it; a newline anywhere earlier means
			// the peer is speaking something else -- an HTTP request, most
			// likely. Blocking on those would itself be the giveaway, since a
			// real web server answers a short request immediately and this one
			// would sit silent until its timeout.
			for i := n; i < n+m; i++ {
				if buf[i] == '\n' && i != AuthLen+1 {
					return nil, buf[:n+m], ErrBadHeader
				}
			}
			n += m
		}
		if rerr != nil {
			return nil, buf[:n], rerr
		}
	}
	if buf[AuthLen] != '\r' || buf[AuthLen+1] != '\n' {
		return nil, buf, ErrBadHeader
	}
	return buf[:AuthLen], buf, nil
}

// ReadRequestBody reads the part of the request that follows the auth token,
// which is only parsed once the token has been accepted.
func ReadRequestBody(r io.Reader) (Request, error) {
	var cmd [1]byte
	if _, err := io.ReadFull(r, cmd[:]); err != nil {
		return Request{}, err
	}
	switch cmd[0] {
	case CmdConnect, CmdUDPAssociate:
	default:
		return Request{}, ErrBadHeader
	}
	target, err := ReadAddr(r)
	if err != nil {
		return Request{}, err
	}
	var padLen [1]byte
	if _, err := io.ReadFull(r, padLen[:]); err != nil {
		return Request{}, err
	}
	if _, err := io.CopyN(io.Discard, r, int64(padLen[0])); err != nil {
		return Request{}, err
	}
	var tail [2]byte
	if _, err := io.ReadFull(r, tail[:]); err != nil {
		return Request{}, err
	}
	if tail[0] != '\r' || tail[1] != '\n' {
		return Request{}, ErrBadHeader
	}
	return Request{Command: cmd[0], Target: target}, nil
}

// Datagram is one UDP packet travelling through a tunnel.
//
// On the client-to-server leg Addr is where the packet is going; on the way
// back it is where the packet came from. Length is explicit because a stream
// has no record boundaries of its own.
type Datagram struct {
	Addr    Addr
	Payload []byte
}

// AppendTo encodes the datagram: addr | length | CRLF | payload.
func (d Datagram) AppendTo(b []byte) []byte {
	b = d.Addr.AppendTo(b)
	b = binary.BigEndian.AppendUint16(b, uint16(len(d.Payload)))
	b = append(b, crlf...)
	return append(b, d.Payload...)
}

// ReadDatagram decodes one datagram frame, reusing buf when it is large
// enough. The returned payload aliases buf, so callers must finish with it
// before the next read.
func ReadDatagram(r io.Reader, buf []byte) (Datagram, error) {
	addr, err := ReadAddr(r)
	if err != nil {
		return Datagram{}, err
	}
	var head [4]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return Datagram{}, err
	}
	length := int(binary.BigEndian.Uint16(head[:2]))
	if head[2] != '\r' || head[3] != '\n' {
		return Datagram{}, ErrBadHeader
	}
	if length > len(buf) {
		return Datagram{}, ErrTooLarge
	}
	if _, err := io.ReadFull(r, buf[:length]); err != nil {
		return Datagram{}, err
	}
	return Datagram{Addr: addr, Payload: buf[:length]}, nil
}
