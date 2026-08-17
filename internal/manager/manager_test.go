package manager

import (
	"context"
	"errors"
	"net"
	"testing"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
)

func newManager(t *testing.T, tweak func(*config.Client)) (*Manager, *config.Client) {
	t.Helper()
	cfg := &config.Client{
		Listen: "127.0.0.1:1080",
		Servers: []config.Remote{
			{ID: "jp", Name: "Japan", Country: "JP", Address: "127.0.0.1:1", Password: "long-enough-password"},
		},
		Route: config.Route{Final: "proxy"},
	}
	if tweak != nil {
		tweak(cfg)
	}
	if err := config.Validate(cfg); err != nil {
		t.Fatalf("config: %v", err)
	}
	m, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return m, cfg
}

// TestDialFailsClosedWhileDisconnected is the security-relevant default. If a
// disconnected client quietly dialled out directly, an application would see
// success and the user would believe the tunnel carried it. The failure has to
// be visible.
func TestDialFailsClosedWhileDisconnected(t *testing.T) {
	m, _ := newManager(t, nil)

	target, _ := protocol.ParseAddr("example.com:443")
	_, err := m.Dial(context.Background(), target)
	if !errors.Is(err, ErrDisconnected) {
		t.Errorf("Dial while disconnected = %v, want ErrDisconnected", err)
	}

	if _, err := m.DialPacket(context.Background()); !errors.Is(err, ErrDisconnected) {
		t.Errorf("DialPacket while disconnected = %v, want ErrDisconnected", err)
	}
}

// TestDirectModeBypassesTheTunnelWhenDisconnected covers the opt-in
// alternative, which must actually reach the destination.
func TestDirectModeBypassesTheTunnelWhenDisconnected(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()

	bypass := false
	m, _ := newManager(t, func(c *config.Client) {
		c.WhenDisconnected = "direct"
		c.Route.BypassPrivate = &bypass
	})

	target, _ := protocol.ParseAddr(ln.Addr().String())
	conn, err := m.Dial(context.Background(), target)
	if err != nil {
		t.Fatalf("Dial in direct mode = %v, want success", err)
	}
	conn.Close()
}

// TestBlockedDestinationsAreRefusedEvenWhenDisconnected checks that routing
// rules are not skipped just because no server is active.
func TestBlockedDestinationsAreRefusedEvenWhenDisconnected(t *testing.T) {
	m, _ := newManager(t, func(c *config.Client) {
		c.WhenDisconnected = "direct"
		c.Route.Block = []string{"blocked.test"}
	})

	target, _ := protocol.ParseAddr("blocked.test:80")
	_, err := m.Dial(context.Background(), target)

	var blocked *proxy.ErrBlocked
	if !errors.As(err, &blocked) {
		t.Errorf("Dial to a blocked host = %v, want ErrBlocked", err)
	}
}

func TestConnectToUnknownServer(t *testing.T) {
	m, cfg := newManager(t, nil)

	err := m.Connect(context.Background(), cfg, "atlantis")
	if !errors.Is(err, ErrUnknownServer) {
		t.Errorf("Connect to an unknown id = %v, want ErrUnknownServer", err)
	}
	if got := m.Status().State; got != StateDisconnected {
		t.Errorf("state = %q, want disconnected", got)
	}
}

// TestFailedConnectLeavesTunnelDown guards against a half-connected state that
// the console would display as protected.
func TestFailedConnectLeavesTunnelDown(t *testing.T) {
	m, cfg := newManager(t, nil)

	if err := m.Connect(context.Background(), cfg, "jp"); err == nil {
		t.Fatal("connecting to a closed port succeeded")
	}
	st := m.Status()
	if st.State != StateDisconnected {
		t.Errorf("state = %q, want disconnected", st.State)
	}
	if st.LastError == "" {
		t.Error("last_error was not recorded")
	}

	// Traffic must still fail closed after a failed attempt.
	target, _ := protocol.ParseAddr("example.com:443")
	if _, err := m.Dial(context.Background(), target); !errors.Is(err, ErrDisconnected) {
		t.Errorf("Dial after a failed connect = %v, want ErrDisconnected", err)
	}
}

func TestDisconnectIsIdempotent(t *testing.T) {
	m, _ := newManager(t, nil)

	m.Disconnect()
	m.Disconnect()
	if got := m.Status().State; got != StateDisconnected {
		t.Errorf("state = %q, want disconnected", got)
	}
}

func TestServersExposeConfiguredMetadata(t *testing.T) {
	m, _ := newManager(t, func(c *config.Client) {
		c.Servers = append(c.Servers, config.Remote{
			ID: "us", Name: "United States", Country: "US",
			Address: "127.0.0.1:1", Password: "another-long-password",
		})
	})

	servers := m.Servers()
	if len(servers) != 2 {
		t.Fatalf("got %d servers, want 2", len(servers))
	}
	if servers[1].ID != "us" || servers[1].Country != "US" {
		t.Errorf("second server = %+v", servers[1])
	}
	for _, s := range servers {
		if s.LatencyMS != -1 {
			t.Errorf("%s: latency = %d before any probe, want -1", s.ID, s.LatencyMS)
		}
	}
}

// TestCountedConnCloseIsIdempotent matters because the relay closes both ends
// and the front ends often close again on the way out; double counting would
// drive the console's active-connection figure negative.
func TestCountedConnCloseIsIdempotent(t *testing.T) {
	m, _ := newManager(t, nil)

	local, remote := net.Pipe()
	defer remote.Close()

	conn := m.count(local)
	if got := m.Status().ActiveConns; got != 1 {
		t.Fatalf("active connections = %d, want 1", got)
	}
	conn.Close()
	conn.Close()
	if got := m.Status().ActiveConns; got != 0 {
		t.Errorf("active connections after two closes = %d, want 0", got)
	}
}

func TestCountedConnRecordsTraffic(t *testing.T) {
	m, _ := newManager(t, nil)

	local, remote := net.Pipe()
	conn := m.count(local)

	go func() {
		buf := make([]byte, 5)
		remote.Read(buf)
		remote.Write([]byte("worldwide"))
	}()

	if _, err := conn.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 9)
	if _, err := conn.Read(buf); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	remote.Close()

	st := m.Status()
	if st.BytesUp != 5 {
		t.Errorf("bytes_up = %d, want 5", st.BytesUp)
	}
	if st.BytesDown != 9 {
		t.Errorf("bytes_down = %d, want 9", st.BytesDown)
	}
	if st.TotalConns != 1 {
		t.Errorf("total_conns = %d, want 1", st.TotalConns)
	}
}
