// Package server terminates veil tunnels and forwards their traffic.
package server

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/relay"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/route"
)

// Server accepts TLS connections and serves the veil protocol.
type Server struct {
	cfg    *config.Server
	certs  *certKeeper
	users  map[string]string // auth token -> user name
	dialer *net.Dialer

	handshakeTimeout time.Duration
	idleTimeout      time.Duration

	wg sync.WaitGroup
}

// New builds a Server from configuration.
func New(cfg *config.Server) (*Server, error) {
	certs, err := newCertKeeper(cfg.TLS.Cert, cfg.TLS.Key)
	if err != nil {
		return nil, err
	}

	users := make(map[string]string, len(cfg.Users))
	for _, u := range cfg.Users {
		users[string(protocol.Token(u.Password))] = u.Name
	}

	return &Server{
		cfg:              cfg,
		certs:            certs,
		users:            users,
		dialer:           &net.Dialer{Timeout: 10 * time.Second},
		handshakeTimeout: cfg.HandshakeTimeout.Or(15 * time.Second),
		idleTimeout:      cfg.IdleTimeout.Or(5 * time.Minute),
	}, nil
}

// TLSConfig builds the listener's TLS settings.
//
// TLS 1.3 only. Older versions are still common on the public web, but their
// handshakes expose the certificate in the clear, which hands a censor an easy
// way to identify every server by name.
//
// The advertised protocol list comes from the configuration rather than being
// fixed here, because whatever is promised in the handshake has to be
// deliverable by the fallback site. A server that negotiates h2 and then hands
// the connection to an HTTP/1.1-only decoy fails every probe in a way that no
// real website does.
func (s *Server) TLSConfig() *tls.Config {
	alpn := s.cfg.ALPN
	if len(alpn) == 0 {
		alpn = []string{"http/1.1"}
	}
	return &tls.Config{
		GetCertificate: s.certs.get,
		MinVersion:     tls.VersionTLS13,
		NextProtos:     alpn,
	}
}

// ReloadCertificate re-reads the certificate from disk, for use after renewal.
func (s *Server) ReloadCertificate() error { return s.certs.reload() }

// Serve accepts connections until ctx is cancelled.
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
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			return fmt.Errorf("server: accept: %w", err)
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

// serveConn handles one inbound connection from TLS handshake to teardown.
func (s *Server) serveConn(ctx context.Context, raw net.Conn) {
	defer raw.Close()

	if tc, ok := raw.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
	}

	tlsConn := tls.Server(raw, s.TLSConfig())
	handshakeCtx, cancel := context.WithTimeout(ctx, s.handshakeTimeout)
	defer cancel()

	if err := tlsConn.HandshakeContext(handshakeCtx); err != nil {
		// A failed handshake is usually a scanner or a stray browser. Nothing
		// useful can be forwarded to the fallback at this point, since the
		// peer is not speaking TLS to us at all.
		logx.Debugf("server: tls handshake from %s: %v", raw.RemoteAddr(), err)
		return
	}
	defer tlsConn.Close()

	// Everything read while parsing the header is recorded, so that any
	// failure -- at any point, for any reason -- can hand the connection to
	// the fallback with the peer's own bytes replayed. Uniformity is the point:
	// if some failures produced the decoy site and others produced a silent
	// close, the difference between them would be the signal a prober is
	// looking for.
	tlsConn.SetReadDeadline(time.Now().Add(s.handshakeTimeout))
	rec := &recorder{r: tlsConn}

	token, _, err := protocol.ReadAuth(rec)
	if err != nil {
		s.serveFallback(ctx, tlsConn, rec.recorded(), "malformed request")
		return
	}
	user, ok := s.lookup(token)
	if !ok {
		s.serveFallback(ctx, tlsConn, rec.recorded(), "unknown credential")
		return
	}
	req, err := protocol.ReadRequestBody(rec)
	if err != nil {
		s.serveFallback(ctx, tlsConn, rec.recorded(), "malformed request from a valid credential")
		return
	}
	tlsConn.SetReadDeadline(time.Time{})

	switch req.Command {
	case protocol.CmdConnect:
		err = s.handleConnect(ctx, tlsConn, req.Target, user)
	case protocol.CmdUDPAssociate:
		err = s.handleUDP(ctx, tlsConn, user)
	default:
		err = fmt.Errorf("unsupported command %#x", req.Command)
	}
	if err != nil {
		logx.Debugf("server: %s: %v", user, err)
	}
}

// lookup finds the user owning a token, in constant time with respect to which
// user matched.
func (s *Server) lookup(token []byte) (string, bool) {
	var (
		name  string
		found bool
	)
	for candidate, userName := range s.users {
		if protocol.TokenEqual([]byte(candidate), token) {
			name, found = userName, true
		}
	}
	return name, found
}

// handleConnect opens a TCP connection to the target and relays.
func (s *Server) handleConnect(ctx context.Context, conn net.Conn, target protocol.Addr, user string) error {
	if err := s.checkTarget(target); err != nil {
		return err
	}

	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	remote, err := s.dialer.DialContext(dialCtx, "tcp", target.String())
	if err != nil {
		return fmt.Errorf("connect %s: %w", target, err)
	}
	defer remote.Close()

	// The destination is logged only at debug level. At the default level the
	// server keeps no record of where its users go.
	logx.Debugf("server: %s -> %s", user, target)
	return relay.Pipe(conn, remote, s.idleTimeout)
}

// checkTarget refuses destinations that would turn the server into a window
// onto its own private network. The cloud metadata service at 169.254.169.254
// is the usual prize: reaching it through an open proxy yields the host's
// credentials.
func (s *Server) checkTarget(target protocol.Addr) error {
	if target.Port == 0 {
		return fmt.Errorf("refusing target with port 0")
	}
	if s.cfg.AllowPrivate {
		return nil
	}
	if target.Type == protocol.AtypDomain {
		// Resolve to check where the name actually points, since a domain can
		// be made to resolve into private space.
		ips, err := net.LookupIP(target.Host)
		if err != nil {
			return fmt.Errorf("resolve %s: %w", target.Host, err)
		}
		for _, ip := range ips {
			if route.IsPrivateHost(ip) {
				return fmt.Errorf("refusing %s: resolves to private address %s", target.Host, ip)
			}
		}
		return nil
	}
	if route.IsPrivateHost(target.IP) {
		return fmt.Errorf("refusing private address %s", target.IP)
	}
	return nil
}

// serveFallback hands an unauthenticated connection to a real web server,
// replaying whatever the peer already sent.
//
// This is the whole of the server's answer to active probing. A prober that
// connects and sends anything -- an HTTP request, random bytes, a replayed
// handshake -- gets whatever the fallback site would have said. There is no
// timing difference to measure and no distinctive rejection to fingerprint,
// because the server has not written a single byte of its own.
func (s *Server) serveFallback(ctx context.Context, conn net.Conn, consumed []byte, reason string) {
	logx.Debugf("server: falling back for %s (%s)", conn.RemoteAddr(), reason)

	conn.SetReadDeadline(time.Time{})

	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	upstream, err := s.dialer.DialContext(dialCtx, "tcp", s.cfg.Fallback)
	if err != nil {
		logx.Warnf("server: fallback %s is unreachable: %v", s.cfg.Fallback, err)
		return
	}
	defer upstream.Close()

	if len(consumed) > 0 {
		if _, err := upstream.Write(consumed); err != nil {
			return
		}
	}
	relay.Pipe(conn, upstream, s.idleTimeout)
}

// recorder keeps a copy of everything read through it. Only the header is read
// this way, so the copy is bounded by the largest valid header rather than by
// the length of the session.
type recorder struct {
	r   io.Reader
	buf []byte
}

func (rec *recorder) Read(p []byte) (int, error) {
	n, err := rec.r.Read(p)
	if n > 0 {
		rec.buf = append(rec.buf, p[:n]...)
	}
	return n, err
}

// recorded returns the bytes consumed so far.
func (rec *recorder) recorded() []byte { return rec.buf }

// certKeeper holds the TLS certificate and reloads it from disk on demand, so
// that a renewal does not require a restart and a dropped connection for every
// user.
type certKeeper struct {
	certFile, keyFile string

	mu   sync.RWMutex
	cert *tls.Certificate
	mod  time.Time
}

func newCertKeeper(certFile, keyFile string) (*certKeeper, error) {
	k := &certKeeper{certFile: certFile, keyFile: keyFile}
	if err := k.reload(); err != nil {
		return nil, err
	}
	return k, nil
}

func (k *certKeeper) reload() error {
	cert, err := tls.LoadX509KeyPair(k.certFile, k.keyFile)
	if err != nil {
		return fmt.Errorf("load certificate: %w", err)
	}
	var mod time.Time
	if st, err := os.Stat(k.certFile); err == nil {
		mod = st.ModTime()
	}

	k.mu.Lock()
	k.cert, k.mod = &cert, mod
	k.mu.Unlock()
	return nil
}

// get serves the current certificate to the TLS stack.
func (k *certKeeper) get(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	k.mu.RLock()
	cert := k.cert
	k.mu.RUnlock()
	if cert == nil {
		return nil, errors.New("no certificate loaded")
	}
	return cert, nil
}

// WatchCertificate reloads the certificate whenever the file on disk changes.
// ACME clients renew on their own schedule, and polling the mtime is both
// simpler and more portable than wiring up filesystem notifications for one
// file.
func (s *Server) WatchCertificate(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = time.Hour
	}
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			st, err := os.Stat(s.certs.certFile)
			if err != nil {
				continue
			}
			s.certs.mu.RLock()
			changed := st.ModTime().After(s.certs.mod)
			s.certs.mu.RUnlock()
			if !changed {
				continue
			}
			if err := s.certs.reload(); err != nil {
				logx.Warnf("server: certificate reload failed: %v", err)
				continue
			}
			logx.Infof("server: reloaded renewed certificate")
		}
	}
}
