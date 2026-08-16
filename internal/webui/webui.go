// Package webui serves the local control console: a single page plus the JSON
// API behind it.
//
// The console has no login, because it lives on loopback where the operating
// system already decides who may connect. That makes one threat real and worth
// defending against explicitly: any web page the user happens to have open can
// try to reach 127.0.0.1 from their browser. Without a guard, a page could
// switch servers or disconnect the tunnel behind their back. See guard.
package webui

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/manager"
)

//go:embed assets
var assets embed.FS

// requestHeader must be present on every API call. A cross-origin request
// cannot set a custom header without the browser first sending a CORS
// preflight, which this server never approves -- so a hostile page cannot
// reach the API even though it can reach the port.
const requestHeader = "X-Veil-Console"

// Server serves the console.
type Server struct {
	mgr *manager.Manager
	cfg *config.Client
	mux *http.ServeMux
}

// New builds the console handler.
func New(mgr *manager.Manager, cfg *config.Client) *Server {
	s := &Server{mgr: mgr, cfg: cfg, mux: http.NewServeMux()}

	content, err := fs.Sub(assets, "assets")
	if err != nil {
		panic("webui: embedded assets are missing: " + err.Error())
	}
	s.mux.Handle("GET /", http.FileServer(http.FS(content)))

	s.mux.HandleFunc("GET /api/status", s.handleStatus)
	s.mux.HandleFunc("GET /api/servers", s.handleServers)
	s.mux.HandleFunc("POST /api/connect", s.handleConnect)
	s.mux.HandleFunc("POST /api/disconnect", s.handleDisconnect)
	s.mux.HandleFunc("POST /api/ping", s.handlePing)

	return s
}

// ServeHTTP applies the cross-origin guard, then dispatches.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		if err := guard(r); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
	}
	// No caching: the console's whole job is to show live state.
	w.Header().Set("Cache-Control", "no-store")
	s.mux.ServeHTTP(w, r)
}

// guard rejects API calls that a browser page on another site could have made.
//
// Two checks, because they cover different cases. The custom header stops a
// simple form post or img/script request, none of which can set headers. The
// Origin check stops anything that did earn a preflight from being accepted
// under a different origin.
func guard(r *http.Request) error {
	if r.Header.Get(requestHeader) == "" {
		return fmt.Errorf("missing %s header", requestHeader)
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Same-origin fetches from the console page, and non-browser clients
		// such as curl, send no Origin at all.
		return nil
	}
	host, err := originHost(origin)
	if err != nil {
		return fmt.Errorf("unrecognised origin %q", origin)
	}
	if host != r.Host {
		return fmt.Errorf("cross-origin request from %q is not allowed", origin)
	}
	return nil
}

// originHost extracts the authority from an Origin header value.
func originHost(origin string) (string, error) {
	for _, scheme := range []string{"http://", "https://"} {
		if rest, ok := strings.CutPrefix(origin, scheme); ok {
			if rest == "" {
				return "", errors.New("empty authority")
			}
			return rest, nil
		}
	}
	return "", errors.New("unsupported scheme")
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.mgr.Status())
}

func (s *Server) handleServers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"servers": s.mgr.Servers()})
}

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ServerID string `json:"server_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("malformed request body: %w", err))
		return
	}
	if body.ServerID == "" {
		writeError(w, http.StatusBadRequest, errors.New("server_id is required"))
		return
	}

	// Bound the attempt so a black-holed server cannot hold the request open
	// indefinitely; the console shows "connecting" while this runs.
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	if err := s.mgr.Connect(ctx, s.cfg, body.ServerID); err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, manager.ErrUnknownServer) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, s.mgr.Status())
}

func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	s.mgr.Disconnect()
	writeJSON(w, http.StatusOK, s.mgr.Status())
}

func (s *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ServerID string `json:"server_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("malformed request body: %w", err))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// An empty server_id tests every server, which is what the console's
	// "test all" button uses.
	if body.ServerID == "" {
		for _, srv := range s.mgr.Servers() {
			s.mgr.Ping(ctx, s.cfg, srv.ID)
		}
		writeJSON(w, http.StatusOK, map[string]any{"servers": s.mgr.Servers()})
		return
	}

	elapsed, err := s.mgr.Ping(ctx, s.cfg, body.ServerID)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, manager.ErrUnknownServer) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"server_id":  body.ServerID,
		"latency_ms": elapsed.Milliseconds(),
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// Serve runs the console until ctx is cancelled.
func Serve(ctx context.Context, ln net.Listener, h http.Handler) error {
	srv := &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// WarnIfExposed points out a console reachable from outside this machine.
func WarnIfExposed(listen string) {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return
	}
	if host == "" {
		logx.Warnf("the console is listening on all interfaces and has no login: "+
			"anyone who can reach this machine can switch your server or read your "+
			"traffic statistics (%s)", listen)
		return
	}
	if ip := net.ParseIP(host); ip != nil && !ip.IsLoopback() {
		logx.Warnf("the console is listening on %s, which is not loopback, and has no login", host)
	}
}
