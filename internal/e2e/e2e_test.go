// Package e2e runs a real client against a real server over a real TLS
// connection. The interesting properties of this project -- that a tunnel
// carries traffic correctly, and that a stranger poking at the server finds
// only a website -- are properties of the whole pipeline, so they are tested
// as one.
package e2e

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	xproxy "golang.org/x/net/proxy"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/client"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/manager"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/server"
)

const (
	testPassword  = "a-sufficiently-long-test-password"
	targetBody    = "hello from the origin server"
	fallbackBody  = "<html><body>An ordinary website.</body></html>"
	testSNI       = "veil.test"
	shortDeadline = 10 * time.Second
)

// harness is a complete deployment: an origin server, a decoy site, a veil
// server and a veil client.
type harness struct {
	targetAddr   string // plain HTTP origin the tests fetch
	fallbackAddr string // decoy site the veil server hides behind
	serverAddr   string // veil server's TLS listener
	clientAddr   string // local SOCKS5/HTTP proxy
	certPin      string
}

func newHarness(t *testing.T, tweak func(*config.Client)) *harness {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	h := &harness{}
	h.targetAddr = startHTTPServer(t, targetBody)
	h.fallbackAddr = startHTTPServer(t, fallbackBody)

	certFile, keyFile, pin := writeSelfSignedCert(t)
	h.certPin = pin

	// --- veil server ---
	serverCfg := &config.Server{
		Listen:       "127.0.0.1:0",
		Users:        []config.User{{Name: "tester", Password: testPassword}},
		TLS:          config.TLSConfig{Cert: certFile, Key: keyFile},
		Fallback:     h.fallbackAddr,
		AllowPrivate: true, // the whole test runs on loopback
		LogLevel:     "error",
	}
	srv, err := server.New(serverCfg)
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}
	rawLn, err := net.Listen("tcp", serverCfg.Listen)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	h.serverAddr = rawLn.Addr().String()
	go srv.Serve(ctx, rawLn)
	t.Cleanup(func() { rawLn.Close() })

	// --- veil client ---
	bypass := false
	clientCfg := &config.Client{
		Listen: "127.0.0.1:0",
		Remote: config.Remote{
			Address:     h.serverAddr,
			Password:    testPassword,
			SNI:         testSNI,
			Fingerprint: "chrome",
			Pin:         pin,
		},
		Route:    config.Route{BypassPrivate: &bypass, Final: "proxy"},
		LogLevel: "error",
	}
	if tweak != nil {
		tweak(clientCfg)
	}
	c, err := client.New(clientCfg)
	if err != nil {
		t.Fatalf("client.New: %v", err)
	}
	clientLn, err := net.Listen("tcp", clientCfg.Listen)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	h.clientAddr = clientLn.Addr().String()
	go proxy.New(c, proxy.Options{IdleTimeout: time.Minute, UDP: true}).Serve(ctx, clientLn)
	t.Cleanup(func() { clientLn.Close() })

	waitForListener(t, h.clientAddr)
	return h
}

// TestTCPThroughSOCKS5 is the base case: a request made through the local
// SOCKS5 port must come back with the origin's real response.
func TestTCPThroughSOCKS5(t *testing.T) {
	h := newHarness(t, nil)

	dialer, err := xproxy.SOCKS5("tcp", h.clientAddr, nil, xproxy.Direct)
	if err != nil {
		t.Fatalf("SOCKS5: %v", err)
	}
	httpClient := &http.Client{
		Transport: &http.Transport{DialContext: dialer.(xproxy.ContextDialer).DialContext},
		Timeout:   shortDeadline,
	}
	body := get(t, httpClient, "http://"+h.targetAddr+"/")
	if body != targetBody {
		t.Errorf("body = %q, want %q", body, targetBody)
	}
}

// TestTCPThroughHTTPProxy covers the other front end on the same port.
func TestTCPThroughHTTPProxy(t *testing.T) {
	h := newHarness(t, nil)

	proxyURL := mustParseURL(t, "http://"+h.clientAddr)
	httpClient := &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)},
		Timeout:   shortDeadline,
	}
	body := get(t, httpClient, "http://"+h.targetAddr+"/")
	if body != targetBody {
		t.Errorf("body = %q, want %q", body, targetBody)
	}
}

// TestHTTPProxyCONNECT exercises the tunnelling path a browser uses for HTTPS.
func TestHTTPProxyCONNECT(t *testing.T) {
	h := newHarness(t, nil)

	conn, err := net.DialTimeout("tcp", h.clientAddr, shortDeadline)
	if err != nil {
		t.Fatalf("dial proxy: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(shortDeadline))

	fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", h.targetAddr, h.targetAddr)

	buf := make([]byte, 39)
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read CONNECT reply: %v", err)
	}
	if want := "HTTP/1.1 200 Connection Established\r\n\r\n"; string(buf) != want {
		t.Fatalf("CONNECT reply = %q, want %q", buf, want)
	}

	// The connection is now a raw pipe to the origin.
	fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", h.targetAddr)
	raw, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if !bytes.Contains(raw, []byte(targetBody)) {
		t.Errorf("response %q does not contain the origin's body", raw)
	}
}

// TestKeepAliveReusesUpstream sends two requests over one proxy connection,
// which is how a browser actually behaves.
func TestKeepAliveReusesUpstream(t *testing.T) {
	h := newHarness(t, nil)

	proxyURL := mustParseURL(t, "http://"+h.clientAddr)
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	defer transport.CloseIdleConnections()
	httpClient := &http.Client{Transport: transport, Timeout: shortDeadline}

	for i := 0; i < 3; i++ {
		if body := get(t, httpClient, "http://"+h.targetAddr+"/"); body != targetBody {
			t.Fatalf("request %d: body = %q", i, body)
		}
	}
}

// TestActiveProbeIsIndistinguishableFromTheDecoy is the security property
// that makes the server hard to find. A censor's prober connects to port 443
// and tries things: a plain request, replayed bytes, a wrong password. For
// each of those, the veil server's response must be byte-identical to what the
// decoy site would have said on its own -- same content, same silences, same
// errors. Comparing against the real fallback, rather than against an expected
// string, is the only way to assert that honestly.
func TestActiveProbeIsIndistinguishableFromTheDecoy(t *testing.T) {
	h := newHarness(t, nil)

	probes := map[string][]byte{
		"plain HTTP request": []byte("GET / HTTP/1.1\r\nHost: veil.test\r\nConnection: close\r\n\r\n"),
		"bare newline":       []byte("\r\n\r\n"),
		"random bytes":       append(bytes.Repeat([]byte{0x41}, 128), '\r', '\n', '\r', '\n'),
		"wrong password":     mustEncodeRequest(t, "the-wrong-password-entirely", h.targetAddr),
		"truncated header":   append(protocol.Token(testPassword)[:20], '\r', '\n', '\r', '\n'),
		"hex-shaped token":   append(bytes.Repeat([]byte{'a'}, protocol.AuthLen), '\r', '\n'),
		"no newline at all":  bytes.Repeat([]byte{0x42}, 200),
	}

	// Deliberately not probed: a *valid* token followed by nothing. The server
	// waits for the rest of the header there, while the decoy would answer at
	// once, so the two are distinguishable. Reaching that state requires the
	// password, and anyone holding the password does not need a probe to know
	// what this server is.

	for name, probe := range probes {
		t.Run(name, func(t *testing.T) {
			throughVeil := probeAndRead(t, func() net.Conn { return dialTLS(t, h.serverAddr) }, probe)
			throughDecoy := probeAndRead(t, func() net.Conn { return dialPlain(t, h.fallbackAddr) }, probe)

			if !bytes.Equal(throughVeil, throughDecoy) {
				t.Errorf("probe response differs from the decoy site, so the server is distinguishable\n"+
					" veil server: %q\n decoy site:  %q", truncate(throughVeil, 300), truncate(throughDecoy, 300))
			}
		})
	}
}

// probeAndRead sends a probe and collects whatever comes back before a short
// deadline, treating a timeout as an empty answer.
func probeAndRead(t *testing.T, dial func() net.Conn, probe []byte) []byte {
	t.Helper()
	conn := dial()
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write(probe); err != nil {
		t.Fatalf("write probe: %v", err)
	}
	raw, err := io.ReadAll(io.LimitReader(conn, 4096))
	if err != nil && !isTimeout(err) {
		t.Fatalf("read: %v", err)
	}
	return raw
}

// TestNegotiatedALPNIsOneTheDecoyCanSpeak covers a failure that is invisible
// in a byte-level probe but obvious to any browser or curl. The server hands
// unauthenticated connections to the decoy, which speaks plain HTTP/1.1; if
// the TLS handshake has meanwhile promised h2, the prober sends an HTTP/2
// preface, the decoy answers in HTTP/1.1, and the connection breaks in a way
// no real website breaks. Whatever is advertised has to be deliverable.
func TestNegotiatedALPNIsOneTheDecoyCanSpeak(t *testing.T) {
	h := newHarness(t, nil)

	// Offer what a browser offers and see what comes back.
	conn, err := tls.Dial("tcp", h.serverAddr, &tls.Config{
		ServerName:         testSNI,
		InsecureSkipVerify: true,
		NextProtos:         []string{"h2", "http/1.1"},
	})
	if err != nil {
		t.Fatalf("tls dial: %v", err)
	}
	defer conn.Close()

	if got := conn.ConnectionState().NegotiatedProtocol; got != "http/1.1" {
		t.Errorf("negotiated ALPN = %q, want http/1.1: the fallback cannot speak anything else", got)
	}
}

// TestBrowserLikeProbeGetsTheDecoySite is the same check from the outside: a
// full HTTPS request made the way a browser makes one must return the decoy's
// page, not a broken connection.
func TestBrowserLikeProbeGetsTheDecoySite(t *testing.T) {
	h := newHarness(t, nil)

	httpClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig:   &tls.Config{ServerName: testSNI, InsecureSkipVerify: true},
			ForceAttemptHTTP2: true,
		},
		Timeout: shortDeadline,
	}
	resp, err := httpClient.Get("https://" + h.serverAddr + "/")
	if err != nil {
		t.Fatalf("a browser-shaped request to the server failed: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != fallbackBody {
		t.Errorf("body = %q, want the decoy site", truncate(body, 200))
	}
}

// TestProbeGetsNoBytesBeforeItSpeaks checks the subtler half of probe
// resistance: the server must never volunteer anything of its own. If it
// wrote so much as a status byte before the fallback did, that byte would
// identify it.
func TestProbeGetsNoBytesBeforeItSpeaks(t *testing.T) {
	h := newHarness(t, nil)

	conn := dialTLS(t, h.serverAddr)
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
	buf := make([]byte, 1)
	n, err := conn.Read(buf)
	if n > 0 {
		t.Errorf("server sent %d unsolicited byte(s) (%#x) before the client said anything", n, buf[:n])
	}
	if err != nil && !isTimeout(err) {
		t.Errorf("expected a timeout with no data, got %v", err)
	}
}

// TestBlockedRouteIsRefusedDistinctly checks that a rule-blocked destination
// reports "not allowed" rather than a generic failure, so the browser can say
// something useful.
func TestBlockedRouteIsRefusedDistinctly(t *testing.T) {
	h := newHarness(t, func(c *config.Client) {
		c.Route.Block = []string{"blocked.test"}
	})

	conn, err := net.DialTimeout("tcp", h.clientAddr, shortDeadline)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(shortDeadline))

	// SOCKS5 greeting and a CONNECT to the blocked name.
	conn.Write([]byte{0x05, 0x01, 0x00})
	reply := make([]byte, 2)
	if _, err := io.ReadFull(conn, reply); err != nil {
		t.Fatal(err)
	}

	target, _ := protocol.ParseAddr("blocked.test:80")
	req := append([]byte{0x05, 0x01, 0x00}, target.AppendTo(nil)...)
	conn.Write(req)

	head := make([]byte, 3)
	if _, err := io.ReadFull(conn, head); err != nil {
		t.Fatal(err)
	}
	const repNotAllowed = 0x02
	if head[1] != repNotAllowed {
		t.Errorf("SOCKS reply code = %#x, want %#x (connection not allowed by ruleset)", head[1], repNotAllowed)
	}
}

// TestDirectRouteBypassesTunnel proves the routing split does what it claims:
// a destination marked direct must be reachable even with the veil server
// stopped, because it never touches the tunnel.
func TestDirectRouteBypassesTunnel(t *testing.T) {
	h := newHarness(t, func(c *config.Client) {
		c.Route.Direct = []string{"127.0.0.1"}
		// Point at a server that does not exist, so anything routed through
		// the tunnel is guaranteed to fail.
		c.Remote.Address = "127.0.0.1:1"
	})

	dialer, err := xproxy.SOCKS5("tcp", h.clientAddr, nil, xproxy.Direct)
	if err != nil {
		t.Fatal(err)
	}
	httpClient := &http.Client{
		Transport: &http.Transport{DialContext: dialer.(xproxy.ContextDialer).DialContext},
		Timeout:   shortDeadline,
	}
	if body := get(t, httpClient, "http://"+h.targetAddr+"/"); body != targetBody {
		t.Errorf("body = %q, want %q", body, targetBody)
	}
}

// TestUDPThroughTunnel exercises the datagram path that DNS and QUIC need.
func TestUDPThroughTunnel(t *testing.T) {
	h := newHarness(t, nil)
	echoAddr := startUDPEcho(t)

	ctrl, relayAddr := socks5Associate(t, h.clientAddr)
	defer ctrl.Close()

	local, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()

	relay, err := net.ResolveUDPAddr("udp", relayAddr)
	if err != nil {
		t.Fatal(err)
	}
	dst, err := protocol.ParseAddr(echoAddr)
	if err != nil {
		t.Fatal(err)
	}

	payload := []byte("datagrams travel too")
	packet := append([]byte{0, 0, 0}, dst.AppendTo(nil)...)
	packet = append(packet, payload...)

	if _, err := local.WriteTo(packet, relay); err != nil {
		t.Fatalf("send: %v", err)
	}

	local.SetReadDeadline(time.Now().Add(shortDeadline))
	buf := make([]byte, 2048)
	n, _, err := local.ReadFrom(buf)
	if err != nil {
		t.Fatalf("read reply: %v", err)
	}
	if n < 3 {
		t.Fatalf("reply too short: %d bytes", n)
	}
	reply := buf[3:n]
	// Skip the address header to reach the echoed payload.
	addr, err := protocol.ReadAddr(bytes.NewReader(reply))
	if err != nil {
		t.Fatalf("parse reply address: %v", err)
	}
	headerLen := len(addr.AppendTo(nil))
	if got := reply[headerLen:]; !bytes.Equal(got, payload) {
		t.Errorf("echoed payload = %q, want %q", got, payload)
	}
}

// TestWrongPinIsRejected confirms the client verifies the server's identity:
// pinning is the recommended way to run without a public CA, so it has to
// actually fail on a mismatch.
func TestWrongPinIsRejected(t *testing.T) {
	h := newHarness(t, func(c *config.Client) {
		wrong := sha256.Sum256([]byte("not the server's certificate"))
		c.Remote.Pin = hex.EncodeToString(wrong[:])
	})

	dialer, err := xproxy.SOCKS5("tcp", h.clientAddr, nil, xproxy.Direct)
	if err != nil {
		t.Fatal(err)
	}
	httpClient := &http.Client{
		Transport: &http.Transport{DialContext: dialer.(xproxy.ContextDialer).DialContext},
		Timeout:   shortDeadline,
	}
	if _, err := httpClient.Get("http://" + h.targetAddr + "/"); err == nil {
		t.Error("request succeeded despite a mismatched certificate pin")
	}
}

// TestLargeTransfer moves enough data to cross many TLS records and exercise
// the relay's buffering.
func TestLargeTransfer(t *testing.T) {
	payload := bytes.Repeat([]byte("veil"), 512*1024) // 2 MiB

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				io.Copy(io.Discard, io.LimitReader(conn, 1))
				conn.Write(payload)
			}()
		}
	}()

	h := newHarness(t, nil)
	dialer, err := xproxy.SOCKS5("tcp", h.clientAddr, nil, xproxy.Direct)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := dialer.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("dial through tunnel: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(30 * time.Second))

	conn.Write([]byte{'x'})
	got, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != len(payload) {
		t.Fatalf("received %d bytes, want %d", len(got), len(payload))
	}
	if !bytes.Equal(got, payload) {
		t.Error("payload was corrupted in transit")
	}
}

// --- helpers ---

func startHTTPServer(t *testing.T, body string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, body)
		}),
	}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return ln.Addr().String()
}

func startUDPEcho(t *testing.T) string {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })

	go func() {
		buf := make([]byte, 2048)
		for {
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			pc.WriteTo(buf[:n], from)
		}
	}()
	return pc.LocalAddr().String()
}

// socks5Associate performs a SOCKS5 UDP ASSOCIATE and returns the control
// connection (which must stay open) and the relay address to send datagrams to.
func socks5Associate(t *testing.T, proxyAddr string) (net.Conn, string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", proxyAddr, shortDeadline)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetDeadline(time.Now().Add(shortDeadline))

	conn.Write([]byte{0x05, 0x01, 0x00})
	greeting := make([]byte, 2)
	if _, err := io.ReadFull(conn, greeting); err != nil {
		t.Fatal(err)
	}

	req := []byte{0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0}
	conn.Write(req)

	head := make([]byte, 3)
	if _, err := io.ReadFull(conn, head); err != nil {
		t.Fatal(err)
	}
	if head[1] != 0x00 {
		t.Fatalf("UDP ASSOCIATE failed with code %#x", head[1])
	}
	bound, err := protocol.ReadAddr(conn)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetDeadline(time.Time{})
	return conn, bound.String()
}

// writeSelfSignedCert produces a certificate for the test server and returns
// its paths along with the SHA-256 pin the client will check.
func writeSelfSignedCert(t *testing.T) (certFile, keyFile, pin string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: testSNI},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{testSNI},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	certFile = filepath.Join(dir, "cert.pem")
	keyFile = filepath.Join(dir, "key.pem")
	writeFile(t, certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	writeFile(t, keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))

	sum := sha256.Sum256(der)
	return certFile, keyFile, hex.EncodeToString(sum[:])
}

func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func dialPlain(t *testing.T, addr string) net.Conn {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, shortDeadline)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	return conn
}

func dialTLS(t *testing.T, addr string) *tls.Conn {
	t.Helper()
	conn, err := tls.Dial("tcp", addr, &tls.Config{
		ServerName:         testSNI,
		InsecureSkipVerify: true, // the probe deliberately does not verify
	})
	if err != nil {
		t.Fatalf("tls dial: %v", err)
	}
	return conn
}

func mustEncodeRequest(t *testing.T, password, target string) []byte {
	t.Helper()
	addr, err := protocol.ParseAddr(target)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := protocol.EncodeRequest(protocol.Token(password),
		protocol.Request{Command: protocol.CmdConnect, Target: addr})
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func get(t *testing.T, c *http.Client, url string) string {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(body)
}

func waitForListener(t *testing.T, addr string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			conn.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("listener %s never came up", addr)
}

func isTimeout(err error) bool {
	var ne net.Error
	return err != nil && errors.As(err, &ne) && ne.Timeout()
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return u
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}

// TestManagerCountsRealTraffic covers the path the shipped client actually
// uses: the proxy front end dialling through the connection manager rather
// than through a client directly. The console reports what this records, so a
// counter stuck at zero means the console tells the user nothing.
func TestManagerCountsRealTraffic(t *testing.T) {
	h := newHarness(t, nil)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	bypass := false
	cfg := &config.Client{
		Listen: "127.0.0.1:0",
		Servers: []config.Remote{{
			ID: "test", Name: "Test", Address: h.serverAddr,
			Password: testPassword, SNI: testSNI, Fingerprint: "chrome", Pin: h.certPin,
		}},
		Route:    config.Route{BypassPrivate: &bypass, Final: "proxy"},
		LogLevel: "error",
	}
	if err := config.Validate(cfg); err != nil {
		t.Fatal(err)
	}
	mgr, err := manager.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := mgr.Connect(ctx, cfg, "test"); err != nil {
		t.Fatalf("connect: %v", err)
	}

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go proxy.New(mgr, proxy.Options{IdleTimeout: time.Minute, UDP: true}).Serve(ctx, ln)
	waitForListener(t, ln.Addr().String())

	dialer, err := xproxy.SOCKS5("tcp", ln.Addr().String(), nil, xproxy.Direct)
	if err != nil {
		t.Fatal(err)
	}
	httpClient := &http.Client{
		Transport: &http.Transport{DialContext: dialer.(xproxy.ContextDialer).DialContext},
		Timeout:   shortDeadline,
	}
	if body := get(t, httpClient, "http://"+h.targetAddr+"/"); body != targetBody {
		t.Fatalf("body = %q, want %q", body, targetBody)
	}

	st := mgr.Status()
	if st.TotalConns == 0 {
		t.Error("total_conns is 0 after a request that succeeded")
	}
	if st.BytesDown == 0 {
		t.Errorf("bytes_down is 0 after receiving %d bytes of body", len(targetBody))
	}
	if st.BytesUp == 0 {
		t.Error("bytes_up is 0 after sending a request")
	}
}
