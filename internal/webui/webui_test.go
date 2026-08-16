package webui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/manager"
)

// newTestServer builds a console over a manager with two unreachable servers.
// Reachability does not matter for the API surface: port 1 refuses instantly,
// which keeps the failure paths fast and deterministic.
func newTestServer(t *testing.T) (*Server, *config.Client) {
	t.Helper()
	cfg := &config.Client{
		Listen: "127.0.0.1:1080",
		Servers: []config.Remote{
			{ID: "jp", Name: "Japan", Country: "JP", Address: "127.0.0.1:1", Password: "long-enough-password"},
			{ID: "us", Name: "United States", Country: "US", Address: "127.0.0.1:1", Password: "another-long-password"},
		},
		Route: config.Route{Final: "proxy"},
	}
	if err := config.Validate(cfg); err != nil {
		t.Fatalf("config: %v", err)
	}
	mgr, err := manager.New(cfg)
	if err != nil {
		t.Fatalf("manager.New: %v", err)
	}
	return New(mgr, cfg), cfg
}

func do(t *testing.T, s *Server, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func consoleHeaders() map[string]string {
	return map[string]string{requestHeader: "1", "Content-Type": "application/json"}
}

// TestAPIRequiresTheConsoleHeader is the core of the cross-origin defence. A
// hostile page can make the browser send a plain request to 127.0.0.1, but it
// cannot attach a custom header without a preflight this server never
// approves. Without this check, any open tab could disconnect the tunnel.
func TestAPIRequiresTheConsoleHeader(t *testing.T) {
	s, _ := newTestServer(t)

	for _, path := range []string{"/api/status", "/api/servers"} {
		if got := do(t, s, "GET", path, "", nil).Code; got != http.StatusForbidden {
			t.Errorf("GET %s without the header = %d, want 403", path, got)
		}
	}
	for _, path := range []string{"/api/connect", "/api/disconnect", "/api/ping"} {
		if got := do(t, s, "POST", path, `{}`, nil).Code; got != http.StatusForbidden {
			t.Errorf("POST %s without the header = %d, want 403", path, got)
		}
	}
}

// TestAPIRejectsCrossOriginRequests covers the case where a header did get
// through: the request must still be refused if it claims another origin.
func TestAPIRejectsCrossOriginRequests(t *testing.T) {
	s, _ := newTestServer(t)

	h := consoleHeaders()
	h["Origin"] = "https://evil.example"
	if got := do(t, s, "POST", "/api/disconnect", `{}`, h).Code; got != http.StatusForbidden {
		t.Errorf("cross-origin POST = %d, want 403", got)
	}

	// The console's own page sends its real origin, which must be accepted.
	h["Origin"] = "http://example.com" // httptest's default r.Host
	if got := do(t, s, "POST", "/api/disconnect", `{}`, h).Code; got != http.StatusOK {
		t.Errorf("same-origin POST = %d, want 200", got)
	}
}

func TestStatusReportsDisconnectedInitially(t *testing.T) {
	s, _ := newTestServer(t)

	w := do(t, s, "GET", "/api/status", "", consoleHeaders())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var st manager.Status
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.State != manager.StateDisconnected {
		t.Errorf("state = %q, want disconnected", st.State)
	}
	if st.ProxyListen != "127.0.0.1:1080" {
		t.Errorf("proxy_listen = %q", st.ProxyListen)
	}
	// The console shows this to explain what happens to traffic right now, so
	// it has to be populated.
	if st.WhenDisconnected != "block" {
		t.Errorf("when_disconnected = %q, want block", st.WhenDisconnected)
	}
}

func TestServersAreListedWithMetadata(t *testing.T) {
	s, _ := newTestServer(t)

	w := do(t, s, "GET", "/api/servers", "", consoleHeaders())
	var body struct{ Servers []manager.Server }
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Servers) != 2 {
		t.Fatalf("got %d servers, want 2", len(body.Servers))
	}
	if body.Servers[0].ID != "jp" || body.Servers[0].Country != "JP" {
		t.Errorf("first server = %+v", body.Servers[0])
	}
	// Untested servers report -1 so the console can show a dash rather than
	// implying a real measurement of zero.
	if body.Servers[0].LatencyMS != -1 {
		t.Errorf("latency before testing = %d, want -1", body.Servers[0].LatencyMS)
	}
}

func TestConnectToUnknownServerIsNotFound(t *testing.T) {
	s, _ := newTestServer(t)

	w := do(t, s, "POST", "/api/connect", `{"server_id":"nowhere"}`, consoleHeaders())
	if w.Code != http.StatusNotFound {
		t.Errorf("connect to an unknown server = %d, want 404", w.Code)
	}
}

func TestConnectToUnreachableServerReportsFailure(t *testing.T) {
	s, _ := newTestServer(t)

	w := do(t, s, "POST", "/api/connect", `{"server_id":"jp"}`, consoleHeaders())
	if w.Code != http.StatusBadGateway {
		t.Errorf("connect to an unreachable server = %d, want 502", w.Code)
	}

	// A failed attempt must leave the tunnel down, not in a half-connected
	// state that the console would render as protected.
	var st manager.Status
	json.Unmarshal(do(t, s, "GET", "/api/status", "", consoleHeaders()).Body.Bytes(), &st)
	if st.State != manager.StateDisconnected {
		t.Errorf("state after a failed connect = %q, want disconnected", st.State)
	}
	if st.LastError == "" {
		t.Error("last_error is empty after a failed connect")
	}
}

func TestConnectRejectsMalformedBody(t *testing.T) {
	s, _ := newTestServer(t)

	if got := do(t, s, "POST", "/api/connect", `not json`, consoleHeaders()).Code; got != http.StatusBadRequest {
		t.Errorf("malformed body = %d, want 400", got)
	}
	if got := do(t, s, "POST", "/api/connect", `{}`, consoleHeaders()).Code; got != http.StatusBadRequest {
		t.Errorf("missing server_id = %d, want 400", got)
	}
}

func TestConsolePageIsServed(t *testing.T) {
	s, _ := newTestServer(t)

	w := do(t, s, "GET", "/", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("GET / = %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{"veil", "id=\"power\"", "/api/status", requestHeader} {
		if !strings.Contains(body, want) {
			t.Errorf("console page does not contain %q", want)
		}
	}
}

// TestPingAllReportsEveryServer covers the "test all" button, which must come
// back with an entry per server even when every one of them fails.
func TestPingAllReportsEveryServer(t *testing.T) {
	s, _ := newTestServer(t)

	w := do(t, s, "POST", "/api/ping", `{}`, consoleHeaders())
	if w.Code != http.StatusOK {
		t.Fatalf("ping all = %d", w.Code)
	}
	var body struct{ Servers []manager.Server }
	json.Unmarshal(w.Body.Bytes(), &body)
	if len(body.Servers) != 2 {
		t.Fatalf("got %d servers, want 2", len(body.Servers))
	}
	for _, srv := range body.Servers {
		if srv.LatencyMS != -1 {
			t.Errorf("%s: latency = %d, want -1 after a failed probe", srv.ID, srv.LatencyMS)
		}
	}
}
