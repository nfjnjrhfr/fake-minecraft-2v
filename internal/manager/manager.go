// Package manager owns the client's connection state: which server is active,
// whether the tunnel is up, and what has flowed through it.
//
// The local proxy port is always listening. What changes at runtime is where
// its traffic goes -- through the active server, straight out, or nowhere --
// so switching servers or disconnecting never has to tear down the listener
// that applications are pointed at.
package manager

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/client"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/route"
)

// State is the tunnel's current condition.
type State string

// Possible states.
const (
	StateDisconnected State = "disconnected"
	StateConnecting   State = "connecting"
	StateConnected    State = "connected"
)

// ErrDisconnected is returned for traffic arriving while no server is active
// and the configured behaviour is to refuse it.
var ErrDisconnected = errors.New("not connected: no server is active")

// ErrUnknownServer names a server that is not configured.
var ErrUnknownServer = errors.New("unknown server")

// Server is one configured endpoint, as the console sees it.
type Server struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Country string `json:"country"`
	Address string `json:"address"`

	// LatencyMS is the last measured handshake time, or -1 when the server has
	// not been tested or the last test failed.
	LatencyMS int64 `json:"latency_ms"`

	// Error holds why the last test or connection attempt failed.
	Error string `json:"error,omitempty"`
}

// Status is a snapshot for the console.
type Status struct {
	State            State  `json:"state"`
	ServerID         string `json:"server_id,omitempty"`
	ServerName       string `json:"server_name,omitempty"`
	Country          string `json:"country,omitempty"`
	ConnectedSeconds int64  `json:"connected_seconds"`
	BytesUp          uint64 `json:"bytes_up"`
	BytesDown        uint64 `json:"bytes_down"`
	ActiveConns      int64  `json:"active_conns"`
	TotalConns       uint64 `json:"total_conns"`
	ProxyListen      string `json:"proxy_listen"`
	WhenDisconnected string `json:"when_disconnected"`
	LastError        string `json:"last_error,omitempty"`
}

// Manager implements proxy.Dialer on top of a switchable set of servers.
type Manager struct {
	servers    []config.Remote
	byID       map[string]*config.Remote
	router     *route.Router
	blockWhenO bool // refuse traffic while disconnected
	proxyAddr  string

	mu       sync.RWMutex
	state    State
	activeID string
	active   *client.Client
	since    time.Time
	lastErr  string
	latency  map[string]int64

	bytesUp     atomic.Uint64
	bytesDown   atomic.Uint64
	activeConns atomic.Int64
	totalConns  atomic.Uint64

	netDialer *net.Dialer
}

// New builds a Manager from client configuration.
func New(cfg *config.Client) (*Manager, error) {
	final, err := route.ParseDecision(cfg.Route.Final)
	if err != nil {
		return nil, err
	}
	router, err := route.New(cfg.Route.Direct, cfg.Route.Block, cfg.Route.BypassPrivateOr(true), final)
	if err != nil {
		return nil, err
	}

	m := &Manager{
		servers:    cfg.Servers,
		byID:       make(map[string]*config.Remote, len(cfg.Servers)),
		router:     router,
		blockWhenO: cfg.WhenDisconnected != "direct",
		proxyAddr:  cfg.Listen,
		state:      StateDisconnected,
		latency:    make(map[string]int64, len(cfg.Servers)),
		netDialer:  &net.Dialer{Timeout: 10 * time.Second},
	}
	for i := range m.servers {
		s := &m.servers[i]
		m.byID[s.ID] = s
		m.latency[s.ID] = -1
		// Build each client once at startup so that a bad server configuration
		// is an error now, not a surprise the first time someone selects it.
		if _, err := clientFor(cfg, s); err != nil {
			return nil, fmt.Errorf("servers[%d] (%s): %w", i, s.ID, err)
		}
	}
	return m, nil
}

// clientFor builds a client bound to one server, keeping the shared routing
// and timeout settings.
func clientFor(cfg *config.Client, remote *config.Remote) (*client.Client, error) {
	one := *cfg
	one.Remote = *remote
	one.Servers = nil
	return client.New(&one)
}

// Servers lists the configured endpoints with their last measured latency.
func (m *Manager) Servers() []Server {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Server, 0, len(m.servers))
	for i := range m.servers {
		s := &m.servers[i]
		out = append(out, Server{
			ID:        s.ID,
			Name:      s.Name,
			Country:   s.Country,
			Address:   s.Address,
			LatencyMS: m.latency[s.ID],
		})
	}
	return out
}

// Status returns a snapshot of the current connection.
func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()

	st := Status{
		State:            m.state,
		ServerID:         m.activeID,
		BytesUp:          m.bytesUp.Load(),
		BytesDown:        m.bytesDown.Load(),
		ActiveConns:      m.activeConns.Load(),
		TotalConns:       m.totalConns.Load(),
		ProxyListen:      m.proxyAddr,
		WhenDisconnected: map[bool]string{true: "block", false: "direct"}[m.blockWhenO],
		LastError:        m.lastErr,
	}
	if s, ok := m.byID[m.activeID]; ok {
		st.ServerName, st.Country = s.Name, s.Country
	}
	if m.state == StateConnected && !m.since.IsZero() {
		st.ConnectedSeconds = int64(time.Since(m.since).Seconds())
	}
	return st
}

// Connect makes the named server active.
//
// It verifies the tunnel by completing a real handshake before reporting
// success, so the console's "connected" means the server answered -- not
// merely that a configuration entry was selected.
func (m *Manager) Connect(ctx context.Context, cfg *config.Client, id string) error {
	m.mu.Lock()
	remote, ok := m.byID[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("%w: %q", ErrUnknownServer, id)
	}
	m.state = StateConnecting
	m.activeID = id
	m.lastErr = ""
	m.mu.Unlock()

	c, err := clientFor(cfg, remote)
	if err != nil {
		m.fail(err)
		return err
	}
	elapsed, err := c.Probe(ctx)
	if err != nil {
		m.fail(err)
		return fmt.Errorf("connect to %s: %w", remote.Name, err)
	}

	m.mu.Lock()
	m.state = StateConnected
	m.active = c
	m.since = time.Now()
	m.latency[id] = elapsed.Milliseconds()
	m.mu.Unlock()

	// Counters describe the current session, so a reconnect starts from zero
	// rather than showing a total that spans several servers.
	m.bytesUp.Store(0)
	m.bytesDown.Store(0)
	m.totalConns.Store(0)

	logx.Infof("connected to %s (%s) in %dms", remote.Name, remote.Address, elapsed.Milliseconds())
	return nil
}

func (m *Manager) fail(err error) {
	m.mu.Lock()
	m.state = StateDisconnected
	m.active = nil
	m.lastErr = err.Error()
	m.mu.Unlock()
	logx.Warnf("connection failed: %v", err)
}

// Disconnect drops the active server. The proxy port keeps listening.
func (m *Manager) Disconnect() {
	m.mu.Lock()
	was := m.activeID
	m.state = StateDisconnected
	m.active = nil
	m.activeID = ""
	m.since = time.Time{}
	m.mu.Unlock()

	if was != "" {
		logx.Infof("disconnected from %s", was)
	}
}

// Ping measures how long a full handshake to one server takes, without
// disturbing the active connection.
func (m *Manager) Ping(ctx context.Context, cfg *config.Client, id string) (time.Duration, error) {
	m.mu.RLock()
	remote, ok := m.byID[id]
	m.mu.RUnlock()
	if !ok {
		return 0, fmt.Errorf("%w: %q", ErrUnknownServer, id)
	}

	c, err := clientFor(cfg, remote)
	if err != nil {
		return 0, err
	}
	elapsed, err := c.Probe(ctx)

	m.mu.Lock()
	if err != nil {
		m.latency[id] = -1
	} else {
		m.latency[id] = elapsed.Milliseconds()
	}
	m.mu.Unlock()

	return elapsed, err
}

// current returns the active client, or nil when disconnected.
func (m *Manager) current() *client.Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.active
}

// Dial routes one connection, which is where connection state actually takes
// effect.
func (m *Manager) Dial(ctx context.Context, target protocol.Addr) (net.Conn, error) {
	if decision := m.router.Match(target.Hostname()); decision == route.Block {
		return nil, &proxy.ErrBlocked{Host: target.Hostname()}
	}

	active := m.current()
	if active == nil {
		if m.blockWhenO {
			// Failing here is deliberate. Quietly sending the request out
			// untunnelled would look identical to success from the
			// application's side, which is exactly how a leak goes unnoticed.
			return nil, ErrDisconnected
		}
		conn, err := m.netDialer.DialContext(ctx, "tcp", target.String())
		if err != nil {
			return nil, err
		}
		return m.count(conn), nil
	}

	conn, err := active.Dial(ctx, target)
	if err != nil {
		return nil, err
	}
	return m.count(conn), nil
}

// DialPacket opens a datagram session through the active server.
func (m *Manager) DialPacket(ctx context.Context) (proxy.PacketSession, error) {
	active := m.current()
	if active == nil {
		return nil, ErrDisconnected
	}
	return active.DialPacket(ctx)
}

// count wraps a connection so its traffic lands in the console's counters.
func (m *Manager) count(conn net.Conn) net.Conn {
	m.activeConns.Add(1)
	m.totalConns.Add(1)
	return &countedConn{Conn: conn, m: m}
}

// countedConn accumulates byte counts for the status display.
type countedConn struct {
	net.Conn
	m      *Manager
	closed atomic.Bool
}

func (c *countedConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		// Read pulls data from the far end towards the application, so from
		// the user's point of view this is download.
		c.m.bytesDown.Add(uint64(n))
	}
	return n, err
}

func (c *countedConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	if n > 0 {
		c.m.bytesUp.Add(uint64(n))
	}
	return n, err
}

// Close decrements the active count once, however many times it is called.
func (c *countedConn) Close() error {
	if c.closed.CompareAndSwap(false, true) {
		c.m.activeConns.Add(-1)
	}
	return c.Conn.Close()
}

// CloseWrite forwards the half close that the relay depends on.
func (c *countedConn) CloseWrite() error {
	if cw, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return cw.CloseWrite()
	}
	return nil
}

var _ proxy.Dialer = (*Manager)(nil)
