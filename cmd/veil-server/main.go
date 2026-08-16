// Command veil-server terminates veil tunnels.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/server"
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	configPath := flag.String("c", "/etc/veil/server.json", "path to the server configuration file")
	check := flag.Bool("check", false, "validate the configuration and exit")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("veil-server %s\n", version)
		return
	}

	if err := run(*configPath, *check); err != nil {
		fmt.Fprintf(os.Stderr, "veil-server: %v\n", err)
		os.Exit(1)
	}
}

func run(configPath string, checkOnly bool) error {
	var cfg config.Server
	if err := config.Load(configPath, &cfg); err != nil {
		return err
	}
	logx.SetLevel(cfg.LogLevel)

	srv, err := server.New(&cfg)
	if err != nil {
		return err
	}
	if checkOnly {
		fmt.Printf("configuration is valid: %d user(s), listening on %s, fallback %s\n",
			len(cfg.Users), cfg.Listen, cfg.Fallback)
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Certificates are renewed on their own schedule by whatever ACME client
	// the operator uses, so watch for that and pick up the new file without
	// dropping the connections currently in flight.
	go srv.WatchCertificate(ctx, 0)
	go reloadOnSignal(ctx, srv)

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Listen, err)
	}
	defer ln.Close()

	logx.Infof("veil-server %s listening on %s (%d user(s), fallback %s)",
		version, cfg.Listen, len(cfg.Users), cfg.Fallback)
	warnIfPortIsUnusual(cfg.Listen)

	// The listener stays plain: the server performs the TLS handshake itself,
	// per connection and under a timeout, so that a peer which stalls mid
	// handshake cannot hold a slot open indefinitely.
	if err := srv.Serve(ctx, ln); err != nil {
		return err
	}
	logx.Infof("veil-server stopped")
	return nil
}

// reloadOnSignal reloads the certificate on SIGHUP, the conventional way to
// tell a daemon its files changed.
func reloadOnSignal(ctx context.Context, srv *server.Server) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGHUP)
	defer signal.Stop(ch)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ch:
			if err := srv.ReloadCertificate(); err != nil {
				logx.Errorf("certificate reload failed: %v", err)
				continue
			}
			logx.Infof("certificate reloaded")
		}
	}
}

// warnIfPortIsUnusual points out a configuration that undermines the whole
// design: the traffic is indistinguishable from HTTPS only if it is on the
// port where HTTPS lives.
func warnIfPortIsUnusual(listen string) {
	_, port, err := net.SplitHostPort(listen)
	if err != nil || port == "443" {
		return
	}
	logx.Warnf("listening on port %s rather than 443: traffic that looks exactly "+
		"like HTTPS but arrives on an unusual port is easy to single out", port)
}
