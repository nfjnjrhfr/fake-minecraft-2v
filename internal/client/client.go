// Package client dials destinations, either through a veil server or straight
// out, according to the routing rules.
package client

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	utls "github.com/refraction-networking/utls"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/route"
)

// Client implements proxy.Dialer.
type Client struct {
	remote      config.Remote
	router      *route.Router
	token       []byte
	tlsConfig   *utls.Config
	helloID     utls.ClientHelloID
	dialTimeout time.Duration
	netDialer   *net.Dialer
}

// New builds a Client from configuration.
func New(cfg *config.Client) (*Client, error) {
	final, err := route.ParseDecision(cfg.Route.Final)
	if err != nil {
		return nil, err
	}
	router, err := route.New(cfg.Route.Direct, cfg.Route.Block, cfg.Route.BypassPrivateOr(true), final)
	if err != nil {
		return nil, err
	}
	helloID, err := parseFingerprint(cfg.Remote.Fingerprint)
	if err != nil {
		return nil, err
	}

	alpn := cfg.Remote.ALPN
	if len(alpn) == 0 {
		// What a browser offers. Advertising something unusual here would undo
		// the point of imitating a browser's ClientHello in the first place.
		alpn = []string{"h2", "http/1.1"}
	}

	tlsCfg := &utls.Config{
		ServerName:         cfg.Remote.SNI,
		NextProtos:         alpn,
		MinVersion:         utls.VersionTLS12,
		ClientSessionCache: utls.NewLRUClientSessionCache(64),
	}

	switch {
	case cfg.Remote.Pin != "":
		fingerprint, err := parsePin(cfg.Remote.Pin)
		if err != nil {
			return nil, err
		}
		// Verification still happens, just against a key the operator chose
		// rather than a public CA. Go's own verifier is bypassed, so the
		// callback must do the whole job itself.
		tlsCfg.InsecureSkipVerify = true
		tlsCfg.VerifyPeerCertificate = pinVerifier(fingerprint)
	case cfg.Remote.AllowInsecure:
		logx.Warnf("server.allow_insecure is set: the tunnel can be intercepted and read. Use server.pin instead.")
		tlsCfg.InsecureSkipVerify = true
	}

	return &Client{
		remote:      cfg.Remote,
		router:      router,
		token:       protocol.Token(cfg.Remote.Password),
		tlsConfig:   tlsCfg,
		helloID:     helloID,
		dialTimeout: cfg.Remote.ConnectTimeout.Or(10 * time.Second),
		netDialer:   &net.Dialer{Timeout: cfg.Remote.ConnectTimeout.Or(10 * time.Second)},
	}, nil
}

// Router exposes the routing table, for startup logging.
func (c *Client) Router() *route.Router { return c.router }

// Dial opens a stream to target, choosing the tunnel or a direct connection.
func (c *Client) Dial(ctx context.Context, target protocol.Addr) (net.Conn, error) {
	switch decision := c.router.Match(target.Hostname()); decision {
	case route.Block:
		logx.Debugf("block %s", target)
		return nil, &proxy.ErrBlocked{Host: target.Hostname()}
	case route.Direct:
		logx.Debugf("direct %s", target)
		conn, err := c.netDialer.DialContext(ctx, "tcp", target.String())
		if err != nil {
			return nil, err
		}
		return conn, nil
	default:
		logx.Debugf("proxy  %s", target)
		return c.dialTunnel(ctx, protocol.Request{Command: protocol.CmdConnect, Target: target})
	}
}

// DialPacket opens a datagram session. Routing still applies per destination,
// so the session holds a tunnel and a local socket and picks between them for
// each packet.
func (c *Client) DialPacket(ctx context.Context) (proxy.PacketSession, error) {
	return newRoutedPacketSession(ctx, c), nil
}

// dialTunnel opens a TLS connection to the server and prepares the request
// header.
//
// The header is not written here. It is buffered and sent together with the
// first payload bytes, which keeps the tunnel from opening with a small record
// of near-constant size -- a pattern that is easy to match on even when the
// contents are opaque.
func (c *Client) dialTunnel(ctx context.Context, req protocol.Request) (net.Conn, error) {
	if c.dialTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.dialTimeout)
		defer cancel()
	}

	raw, err := c.netDialer.DialContext(ctx, "tcp", c.remote.Address)
	if err != nil {
		return nil, fmt.Errorf("dial server %s: %w", c.remote.Address, err)
	}
	if tc, ok := raw.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
	}

	tlsConn := utls.UClient(raw, c.tlsConfig.Clone(), c.helloID)
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		raw.Close()
		return nil, fmt.Errorf("tls handshake with %s: %w", c.remote.Address, err)
	}

	header, err := protocol.EncodeRequest(c.token, req)
	if err != nil {
		tlsConn.Close()
		return nil, err
	}
	return &lazyConn{Conn: tlsConn, header: header}, nil
}

// lazyConn holds the request header until there is payload to send with it.
type lazyConn struct {
	net.Conn

	mu     sync.Mutex
	header []byte
}

// takeHeader returns the pending header exactly once.
func (c *lazyConn) takeHeader() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	h := c.header
	c.header = nil
	return h
}

func (c *lazyConn) Write(p []byte) (int, error) {
	header := c.takeHeader()
	if header == nil {
		return c.Conn.Write(p)
	}
	buf := make([]byte, 0, len(header)+len(p))
	buf = append(buf, header...)
	buf = append(buf, p...)

	n, err := c.Conn.Write(buf)
	// Report only the caller's own bytes, or io.Copy will believe it wrote
	// more than it handed over and complain about a short write.
	n -= len(header)
	if n < 0 {
		n = 0
	}
	return n, err
}

// Read flushes the header first: a protocol where the server speaks first
// still needs the request to have arrived.
func (c *lazyConn) Read(p []byte) (int, error) {
	if header := c.takeHeader(); header != nil {
		if _, err := c.Conn.Write(header); err != nil {
			return 0, err
		}
	}
	return c.Conn.Read(p)
}

// CloseWrite flushes the header so that a request with no body still reaches
// the server before the write side shuts down.
func (c *lazyConn) CloseWrite() error {
	if header := c.takeHeader(); header != nil {
		if _, err := c.Conn.Write(header); err != nil {
			return err
		}
	}
	if cw, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return cw.CloseWrite()
	}
	return nil
}

// parseFingerprint maps a configuration name onto a ClientHello to imitate.
func parseFingerprint(name string) (utls.ClientHelloID, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "chrome":
		return utls.HelloChrome_Auto, nil
	case "firefox":
		return utls.HelloFirefox_Auto, nil
	case "safari":
		return utls.HelloSafari_Auto, nil
	case "ios":
		return utls.HelloIOS_Auto, nil
	case "edge":
		return utls.HelloEdge_Auto, nil
	case "android":
		return utls.HelloAndroid_11_OkHttp, nil
	case "random", "randomized":
		return utls.HelloRandomizedALPN, nil
	case "go", "golang", "none":
		// Go's native ClientHello. Recognisable, and blocked outright on some
		// networks, so it is never the default.
		return utls.HelloGolang, nil
	default:
		return utls.ClientHelloID{}, fmt.Errorf("unknown server.fingerprint %q "+
			"(chrome, firefox, safari, ios, edge, android, random, go)", name)
	}
}

// parsePin accepts a certificate fingerprint as hex or base64, with or without
// colons, since those are the forms openssl and browsers produce.
func parsePin(pin string) ([]byte, error) {
	cleaned := strings.NewReplacer(":", "", " ", "", "sha256/", "", "SHA256:", "").Replace(pin)
	if b, err := hex.DecodeString(cleaned); err == nil && len(b) == sha256.Size {
		return b, nil
	}
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding} {
		if b, err := enc.DecodeString(cleaned); err == nil && len(b) == sha256.Size {
			return b, nil
		}
	}
	return nil, errors.New("server.pin must be a SHA-256 certificate fingerprint in hex or base64")
}

// pinVerifier checks the leaf certificate against a known fingerprint.
func pinVerifier(want []byte) func([][]byte, [][]*x509.Certificate) error {
	return func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return errors.New("server presented no certificate")
		}
		got := sha256.Sum256(rawCerts[0])
		if subtle.ConstantTimeCompare(got[:], want) != 1 {
			return fmt.Errorf("certificate fingerprint mismatch: server presented %s",
				hex.EncodeToString(got[:]))
		}
		return nil
	}
}
