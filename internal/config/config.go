// Package config loads and validates the JSON configuration for both ends.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

// Duration is a time.Duration that unmarshals from a string like "30s", so
// that config files stay readable instead of carrying raw nanoseconds.
type Duration time.Duration

// UnmarshalJSON parses either a duration string or a plain number of seconds.
func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		v, err := time.ParseDuration(s)
		if err != nil {
			return err
		}
		*d = Duration(v)
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err != nil {
		return fmt.Errorf("duration must be a string like \"30s\" or a number of seconds")
	}
	*d = Duration(time.Duration(n * float64(time.Second)))
	return nil
}

// MarshalJSON renders the duration back as a string.
func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Duration(d).String())
}

// Or returns d, or def when d is unset.
func (d Duration) Or(def time.Duration) time.Duration {
	if d == 0 {
		return def
	}
	return time.Duration(d)
}

// User is one credential accepted by the server.
type User struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

// TLSConfig points at the certificate the server presents. A certificate for a
// domain you really control is not a nicety here: a self-signed one makes the
// server stand out from every other HTTPS host on the internet, which is
// exactly what a blocking system looks for.
type TLSConfig struct {
	Cert string `json:"cert"`
	Key  string `json:"key"`
}

// Server is the server-side configuration.
type Server struct {
	Listen string    `json:"listen"`
	Users  []User    `json:"users"`
	TLS    TLSConfig `json:"tls"`

	// Fallback is a plain HTTP server that receives any connection failing
	// authentication, byte for byte, including whatever the peer already sent.
	// Without it an active prober can confirm a proxy simply by connecting and
	// watching the server hang up on garbage; with it the prober sees a website.
	Fallback string `json:"fallback"`

	// ALPN is the protocol list offered during the TLS handshake. It must not
	// promise more than the fallback can deliver: the server hands probes
	// straight to that decoy, so advertising "h2" while the decoy speaks only
	// HTTP/1.1 makes every probe fail in a way no real website fails. The
	// default is http/1.1 because a decoy receives plaintext HTTP, and
	// cleartext h2 is rarely enabled. Set ["h2","http/1.1"] only if the
	// fallback really does serve h2c.
	ALPN []string `json:"alpn"`

	// AllowPrivate lets clients reach private addresses through this server.
	// Off by default: an open proxy that will connect to 169.254.169.254 hands
	// out its own cloud credentials to anyone holding a password. Turn it on
	// only when the point of the server is to reach a network it sits inside.
	AllowPrivate bool `json:"allow_private"`

	// HandshakeTimeout bounds how long a client may take to send its request
	// header, so idle probes cannot pin down connections.
	HandshakeTimeout Duration `json:"handshake_timeout"`

	// IdleTimeout closes relays that have moved no data in this long.
	IdleTimeout Duration `json:"idle_timeout"`

	LogLevel string `json:"log_level"`
}

// Remote describes the server a client connects to.
type Remote struct {
	// ID identifies this server in the web console and in API calls. It is
	// derived from the name when left empty.
	ID string `json:"id"`

	// Name is what the console shows, e.g. "Japan - Tokyo".
	Name string `json:"name"`

	// Country is an ISO 3166-1 alpha-2 code used only to pick a flag in the
	// console. It has no effect on routing.
	Country string `json:"country"`

	Address  string `json:"address"`
	Password string `json:"password"`

	// SNI overrides the server name sent in the TLS handshake. It defaults to
	// the host part of Address, which is almost always what you want.
	SNI string `json:"sni"`

	// Fingerprint selects which browser's TLS ClientHello to imitate. Go's own
	// handshake has a distinctive shape that some networks block on sight, so
	// the default here is chrome rather than "whatever the runtime does".
	Fingerprint string `json:"fingerprint"`

	// ALPN advertises application protocols. Leave empty to send h2 and
	// http/1.1, matching a browser.
	ALPN []string `json:"alpn"`

	// AllowInsecure disables certificate verification. It exists for testing
	// against a self-signed cert and makes the connection trivially
	// interceptable, so it is refused unless Pin is also empty.
	AllowInsecure bool `json:"allow_insecure"`

	// Pin, when set, requires the server's leaf certificate to have this
	// SHA-256 fingerprint (hex or base64). This is the safe way to run without
	// a public CA: verification still happens, just against a key you chose.
	Pin string `json:"pin"`

	ConnectTimeout Duration `json:"connect_timeout"`
}

// Route selects which destinations go through the tunnel.
type Route struct {
	// BypassPrivate sends loopback, LAN and link-local traffic straight out
	// rather than through the tunnel. On by default; turning it off will send
	// your printer's address to a server on the other side of the world.
	BypassPrivate *bool `json:"bypass_private"`

	// Direct and Block hold matchers: a domain suffix ("example.com" also
	// matches "a.example.com"), an exact domain prefixed with "full:", a CIDR
	// block, or a bare IP.
	Direct []string `json:"direct"`
	Block  []string `json:"block"`

	// Final is what happens to everything else: "proxy" or "direct".
	Final string `json:"final"`
}

// Client is the client-side configuration.
type Client struct {
	// Listen is the local address serving both SOCKS5 and HTTP proxy. Keep it
	// on loopback unless you intend to share the tunnel with your whole LAN.
	Listen string `json:"listen"`

	// Remote is a single server, the original one-server form. Prefer Servers;
	// this is still accepted so existing configs keep working, and is treated
	// as a one-entry server list.
	Remote Remote `json:"server"`

	// Servers is the list the console offers. Exactly one is active at a time.
	Servers []Remote `json:"servers"`

	// AutoConnect names the server to connect to at startup. Empty means start
	// disconnected and wait for the console.
	AutoConnect string `json:"auto_connect"`

	// WhenDisconnected decides what happens to traffic while no server is
	// connected: "block" refuses it, "direct" sends it out untunnelled.
	//
	// The default is block. A proxy that silently falls back to direct while
	// the user believes the tunnel is up is worse than one that fails: the
	// failure is visible, the leak is not.
	WhenDisconnected string `json:"when_disconnected"`

	Web   Web   `json:"web"`
	Route Route `json:"route"`

	// UDP enables SOCKS5 UDP association, which is what DNS and QUIC need.
	UDP *bool `json:"udp"`

	IdleTimeout Duration `json:"idle_timeout"`
	LogLevel    string   `json:"log_level"`
}

// Web configures the local control console.
type Web struct {
	// Enabled turns the console on. It is on by default.
	Enabled *bool `json:"enabled"`

	// Listen is where the console is served. Keep it on loopback: the console
	// can switch servers and read connection statistics, and it has no login.
	Listen string `json:"listen"`
}

// EnabledOr reports whether the console should run.
func (w Web) EnabledOr(def bool) bool {
	if w.Enabled == nil {
		return def
	}
	return *w.Enabled
}

// Load reads and validates a JSON config into dst, which must be *Server or
// *Client. Unknown fields are rejected: a typo in a security-relevant setting
// should be an error, not a silently ignored default.
func Load(path string, dst any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}

	if err := Validate(dst); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

// Validate checks and fills in defaults for a *Server or *Client that was
// built in memory rather than read from a file. Load applies it too, so both
// paths get the same defaults -- a config assembled in code cannot end up with
// settings that a file-based one would never have.
func Validate(dst any) error {
	switch c := dst.(type) {
	case *Server:
		return c.validate()
	case *Client:
		return c.validate()
	default:
		return errors.New("config: unsupported target type")
	}
}

func (s *Server) validate() error {
	if s.Listen == "" {
		s.Listen = ":443"
	}
	if len(s.Users) == 0 {
		return errors.New("no users configured")
	}
	seen := make(map[string]string, len(s.Users))
	for i := range s.Users {
		u := &s.Users[i]
		if u.Password == "" {
			return fmt.Errorf("user %q has an empty password", u.Name)
		}
		if len(u.Password) < 8 {
			return fmt.Errorf("user %q: password must be at least 8 characters", u.Name)
		}
		if u.Name == "" {
			u.Name = fmt.Sprintf("user%d", i+1)
		}
		if other, dup := seen[u.Password]; dup {
			return fmt.Errorf("users %q and %q share a password", other, u.Name)
		}
		seen[u.Password] = u.Name
	}
	if s.TLS.Cert == "" || s.TLS.Key == "" {
		return errors.New("tls.cert and tls.key are required")
	}
	if len(s.ALPN) == 0 {
		s.ALPN = []string{"http/1.1"}
	}
	if s.Fallback == "" {
		return errors.New("fallback is required: without it the server is trivially probed")
	}
	if _, _, err := net.SplitHostPort(s.Fallback); err != nil {
		return fmt.Errorf("fallback must be host:port: %w", err)
	}
	return nil
}

func (c *Client) validate() error {
	if c.Listen == "" {
		c.Listen = "127.0.0.1:1080"
	}
	if c.Web.Listen == "" {
		c.Web.Listen = "127.0.0.1:8088"
	}

	// The single-server form is the one-entry case of the list, so fold it in
	// and validate one shape from here on.
	if c.Remote.Address != "" {
		c.Servers = append([]Remote{c.Remote}, c.Servers...)
		c.Remote = Remote{}
	}
	if len(c.Servers) == 0 {
		return errors.New("no servers configured: set \"servers\" (or the single-server \"server\")")
	}

	seenID := make(map[string]bool, len(c.Servers))
	for i := range c.Servers {
		s := &c.Servers[i]
		if s.Address == "" {
			return fmt.Errorf("servers[%d]: address is required", i)
		}
		host, _, err := net.SplitHostPort(s.Address)
		if err != nil {
			return fmt.Errorf("servers[%d]: address must be host:port: %w", i, err)
		}
		if s.Password == "" {
			return fmt.Errorf("servers[%d]: password is required", i)
		}
		if s.SNI == "" {
			s.SNI = host
		}
		if s.Fingerprint == "" {
			s.Fingerprint = "chrome"
		}
		if s.AllowInsecure && s.Pin != "" {
			return fmt.Errorf("servers[%d]: allow_insecure and pin are mutually exclusive", i)
		}
		if s.Name == "" {
			s.Name = host
		}
		if s.ID == "" {
			s.ID = slug(s.Name)
		}
		if seenID[s.ID] {
			return fmt.Errorf("servers[%d]: duplicate id %q", i, s.ID)
		}
		seenID[s.ID] = true
	}

	if c.AutoConnect != "" && !seenID[c.AutoConnect] {
		return fmt.Errorf("auto_connect names %q, which is not one of the configured servers", c.AutoConnect)
	}
	switch strings.ToLower(c.WhenDisconnected) {
	case "", "block":
		c.WhenDisconnected = "block"
	case "direct":
		c.WhenDisconnected = "direct"
	default:
		return fmt.Errorf("when_disconnected must be \"block\" or \"direct\", got %q", c.WhenDisconnected)
	}

	switch strings.ToLower(c.Route.Final) {
	case "", "proxy":
		c.Route.Final = "proxy"
	case "direct":
		c.Route.Final = "direct"
	default:
		return fmt.Errorf("route.final must be \"proxy\" or \"direct\", got %q", c.Route.Final)
	}
	return nil
}

// BypassPrivate reports whether private-range traffic skips the tunnel.
func (r Route) BypassPrivateOr(def bool) bool {
	if r.BypassPrivate == nil {
		return def
	}
	return *r.BypassPrivate
}

// slug turns a display name into an identifier usable in a URL.
func slug(name string) string {
	var b strings.Builder
	lastDash := true // leading dashes are dropped
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// UDPEnabled reports whether SOCKS5 UDP association is offered.
func (c Client) UDPEnabled() bool {
	if c.UDP == nil {
		return true
	}
	return *c.UDP
}
