// Command veil-decoy is a minimal static web server for the site a veil
// server hides behind.
//
// It exists so that a local deployment can be brought up without installing
// anything else. In a real deployment, prefer a real web server serving a real
// site: the decoy is what an active prober sees, and the more ordinary it
// looks, the better it does its job. A single hand-written page is fine for
// testing and thin cover in production.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"
)

// placeholder is served when no directory is given. It is deliberately dull
// and mentions nothing about proxies.
const placeholder = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>It works</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; display: grid;
         place-items: center; min-height: 100vh; color: #24303a; background: #f6f7f9; }
  main { max-width: 32rem; padding: 2rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: .5rem 0; color: #5b6773; }
</style>
</head>
<body>
<main>
  <h1>It works</h1>
  <p>This server is running but has no site configured yet.</p>
</main>
</body>
</html>
`

func main() {
	listen := flag.String("listen", "127.0.0.1:8081", "address to serve on")
	dir := flag.String("dir", "", "directory to serve (default: a built-in placeholder page)")
	flag.Parse()

	mux := http.NewServeMux()
	if *dir != "" {
		if _, err := os.Stat(*dir); err != nil {
			fmt.Fprintf(os.Stderr, "veil-decoy: %v\n", err)
			os.Exit(1)
		}
		mux.Handle("/", http.FileServer(http.Dir(*dir)))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, placeholder)
		})
	}

	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintf(os.Stderr, "veil-decoy: listen on %s: %v\n", *listen, err)
		os.Exit(1)
	}
	log.Printf("veil-decoy serving on %s", ln.Addr())

	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.Serve(ln); err != nil {
		fmt.Fprintf(os.Stderr, "veil-decoy: %v\n", err)
		os.Exit(1)
	}
}
