// Command veil-client runs the local SOCKS5/HTTP proxy that feeds a veil
// tunnel.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/client"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	configPath := flag.String("c", "client.json", "path to the client configuration file")
	check := flag.Bool("check", false, "validate the configuration and exit")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("veil-client %s\n", version)
		return
	}

	if err := run(*configPath, *check); err != nil {
		fmt.Fprintf(os.Stderr, "veil-client: %v\n", err)
		os.Exit(1)
	}
}

func run(configPath string, checkOnly bool) error {
	var cfg config.Client
	if err := config.Load(configPath, &cfg); err != nil {
		return err
	}
	logx.SetLevel(cfg.LogLevel)

	c, err := client.New(&cfg)
	if err != nil {
		return err
	}
	if checkOnly {
		fmt.Printf("configuration is valid: %s -> %s (%s)\n",
			cfg.Listen, cfg.Remote.Address, c.Router().Summary())
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Listen, err)
	}
	defer ln.Close()

	srv := proxy.New(c, proxy.Options{
		IdleTimeout: cfg.IdleTimeout.Or(5 * time.Minute),
		UDP:         cfg.UDPEnabled(),
	})

	logx.Infof("veil-client %s: SOCKS5 and HTTP proxy on %s -> %s",
		version, cfg.Listen, cfg.Remote.Address)
	logx.Infof("tls fingerprint: %s, sni: %s, routing: %s",
		cfg.Remote.Fingerprint, cfg.Remote.SNI, c.Router().Summary())
	warnIfExposed(cfg.Listen)

	if err := srv.Serve(ctx, ln); err != nil {
		return err
	}
	logx.Infof("veil-client stopped")
	return nil
}

// warnIfExposed flags a listener reachable from outside this machine. The
// local proxy has no authentication, so binding it to a routable address turns
// it into an open proxy that anyone nearby can use -- and that traffic would
// still be attributed to the tunnel's owner.
func warnIfExposed(listen string) {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return
	}
	if host == "" {
		logx.Warnf("listening on all interfaces with no authentication: anyone who "+
			"can reach this machine can use the tunnel. Bind to 127.0.0.1 unless "+
			"you mean to share it (%s)", listen)
		return
	}
	if ip := net.ParseIP(host); ip != nil && !ip.IsLoopback() {
		logx.Warnf("listening on %s, which is not loopback: the proxy has no "+
			"authentication, so anyone who can reach that address can use the tunnel", host)
	}
}
