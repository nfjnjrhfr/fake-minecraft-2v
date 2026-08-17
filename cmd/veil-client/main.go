// Command veil-client runs the local SOCKS5/HTTP proxy that feeds a veil
// tunnel, together with the web console that controls it.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/config"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/logx"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/manager"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/proxy"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/webui"
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

	mgr, err := manager.New(&cfg)
	if err != nil {
		return err
	}
	if checkOnly {
		fmt.Printf("configuration is valid: %d server(s), proxy on %s, console on %s\n",
			len(cfg.Servers), cfg.Listen, cfg.Web.Listen)
		for _, s := range mgr.Servers() {
			fmt.Printf("  %-16s %s\n", s.ID, s.Address)
		}
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	proxyLn, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Listen, err)
	}
	defer proxyLn.Close()

	// The console listener is opened before anything long-running starts, so a
	// port clash is reported immediately rather than after the proxy is up.
	var consoleLn net.Listener
	if cfg.Web.EnabledOr(true) {
		consoleLn, err = net.Listen("tcp", cfg.Web.Listen)
		if err != nil {
			return fmt.Errorf("listen for the console on %s: %w", cfg.Web.Listen, err)
		}
		defer consoleLn.Close()
	}

	logx.Infof("veil-client %s: SOCKS5 and HTTP proxy on %s", version, cfg.Listen)
	warnIfExposed(cfg.Listen)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		srv := proxy.New(mgr, proxy.Options{
			IdleTimeout: cfg.IdleTimeout.Or(5 * time.Minute),
			UDP:         cfg.UDPEnabled(),
		})
		if err := srv.Serve(ctx, proxyLn); err != nil {
			logx.Errorf("proxy: %v", err)
		}
	}()

	if consoleLn != nil {
		logx.Infof("console: http://%s", cfg.Web.Listen)
		webui.WarnIfExposed(cfg.Web.Listen)

		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := webui.Serve(ctx, consoleLn, webui.New(mgr, &cfg)); err != nil {
				logx.Errorf("console: %v", err)
			}
		}()
	}

	if cfg.AutoConnect != "" {
		go func() {
			if err := mgr.Connect(ctx, &cfg, cfg.AutoConnect); err != nil {
				// Not fatal: the console exists so that a failed server can be
				// swapped for another without restarting.
				logx.Warnf("auto-connect to %s failed: %v", cfg.AutoConnect, err)
			}
		}()
	} else {
		logx.Infof("no auto_connect set; open the console to choose a server")
	}

	wg.Wait()
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
