#!/usr/bin/env bash
#
# Bring up a complete, real veil deployment on this machine: a decoy site, a
# veil server with its own certificate, and a veil client with its console.
#
# Nothing here is simulated. The server terminates real TLS, the client speaks
# the real protocol to it, and traffic sent through the proxy reaches the real
# internet. The only thing it is not is remote -- both ends run locally, so it
# proves the software works and lets you see the console driving a live tunnel,
# but it cannot move your traffic to another country. For that, the server has
# to run somewhere else; see scripts/install-server.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${VEIL_DEMO_DIR:-$ROOT/.demo}"

SERVER_PORT="${VEIL_DEMO_SERVER_PORT:-8443}"
DECOY_PORT="${VEIL_DEMO_DECOY_PORT:-8081}"
PROXY_PORT="${VEIL_DEMO_PROXY_PORT:-1080}"
CONSOLE_PORT="${VEIL_DEMO_CONSOLE_PORT:-8088}"

PASSWORD="${VEIL_DEMO_PASSWORD:-demo-password-not-for-real-use}"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null || die "openssl is required"

pids=()
cleanup() {
    local status=$?
    printf '\n'
    info "shutting down"
    for pid in "${pids[@]:-}"; do
        if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
    done
    wait 2>/dev/null || true
    exit $status
}
trap cleanup EXIT INT TERM

# --- build ------------------------------------------------------------------
info "building"
make -C "$ROOT" build >/dev/null
go build -o "$ROOT/bin/veil-decoy" "$ROOT/./cmd/veil-decoy"

mkdir -p "$DIR"

# --- certificate ------------------------------------------------------------
# Self-signed, because this is a local deployment with no domain. The client
# pins it, so the tunnel is still authenticated -- verification happens against
# this exact key rather than a public CA.
if [[ ! -f "$DIR/cert.pem" ]]; then
    info "generating a certificate for localhost"
    "$ROOT/scripts/gen-cert.sh" 127.0.0.1 "$DIR" >/dev/null
fi
PIN=$(openssl x509 -in "$DIR/cert.pem" -outform der | openssl dgst -sha256 -hex | sed 's/.*= //')

# --- configuration ----------------------------------------------------------
cat > "$DIR/server.json" <<CONF
{
  "listen": "127.0.0.1:$SERVER_PORT",
  "users": [{ "name": "demo", "password": "$PASSWORD" }],
  "tls": { "cert": "$DIR/cert.pem", "key": "$DIR/key.pem" },
  "fallback": "127.0.0.1:$DECOY_PORT",
  "log_level": "info"
}
CONF

cat > "$DIR/client.json" <<CONF
{
  "listen": "127.0.0.1:$PROXY_PORT",
  "web": { "listen": "127.0.0.1:$CONSOLE_PORT" },
  "servers": [
    {
      "id": "local",
      "name": "Local demo server",
      "country": "US",
      "address": "127.0.0.1:$SERVER_PORT",
      "password": "$PASSWORD",
      "sni": "127.0.0.1",
      "pin": "$PIN"
    }
  ],
  "auto_connect": "local",
  "when_disconnected": "block",
  "route": { "bypass_private": true, "final": "proxy" },
  "log_level": "info"
}
CONF

"$ROOT/bin/veil-server" -c "$DIR/server.json" -check >/dev/null || die "server config is invalid"
"$ROOT/bin/veil-client" -c "$DIR/client.json" -check >/dev/null || die "client config is invalid"

# --- start ------------------------------------------------------------------
info "starting the decoy site on 127.0.0.1:$DECOY_PORT"
"$ROOT/bin/veil-decoy" -listen "127.0.0.1:$DECOY_PORT" > "$DIR/decoy.log" 2>&1 &
pids+=($!)

info "starting veil-server on 127.0.0.1:$SERVER_PORT"
"$ROOT/bin/veil-server" -c "$DIR/server.json" > "$DIR/server.log" 2>&1 &
pids+=($!)

info "starting veil-client (proxy :$PROXY_PORT, console :$CONSOLE_PORT)"
"$ROOT/bin/veil-client" -c "$DIR/client.json" > "$DIR/client.log" 2>&1 &
pids+=($!)

# Wait for the client to accept connections rather than sleeping a fixed time.
for _ in $(seq 40); do
    if (exec 3<>/dev/tcp/127.0.0.1/"$PROXY_PORT") 2>/dev/null; then exec 3<&- 3>&-; break; fi
    sleep 0.25
done

# --- prove it carries real traffic -----------------------------------------
# Clearing the proxy variables matters, and so does *how*. curl's --noproxy '*'
# turns off proxying for every host -- including the one given with -x -- so a
# check written that way connects directly and reports success for a request
# that never touched the tunnel. Unsetting the environment instead leaves -x as
# the only proxy in play.
noproxy_env() {
    env -u http_proxy -u HTTP_PROXY -u https_proxy -u HTTPS_PROXY \
        -u all_proxy -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

# Reading the tunnel's own counter is what makes this honest: a request that
# bypassed veil cannot move it.
conns() {
    noproxy_env curl -sS --max-time 10 --noproxy '*' \
        -H 'X-Veil-Console: 1' "http://127.0.0.1:$CONSOLE_PORT/api/status" 2>/dev/null |
        sed -n 's/.*"total_conns":\([0-9]*\).*/\1/p'
}

info "checking that real traffic flows through the tunnel"
if command -v curl >/dev/null; then
    before=$(conns); before=${before:-0}

    if body=$(noproxy_env curl -sS --max-time 20 \
                   -x "socks5h://127.0.0.1:$PROXY_PORT" \
                   https://example.com/ 2>&1); then
        after=$(conns); after=${after:-0}
        if ! grep -qi 'example domain' <<<"$body"; then
            warn "the tunnel answered, but the content was unexpected:"
            printf '%s\n' "${body:0:200}" >&2
        elif (( after > before )); then
            info "fetched the real example.com through the tunnel ($(wc -c <<<"$body") bytes, tunnel connections $before -> $after)"
        else
            warn "example.com was fetched, but the tunnel's connection count did not move"
            warn "the request reached the internet without going through veil"
        fi
    else
        warn "the test request failed: $body"
        warn "see $DIR/client.log and $DIR/server.log"
    fi

    # The other half of the design: an unauthenticated connection to the
    # server must come back with the decoy site, not an error. Here --noproxy
    # is right, because this one really should be a direct connection.
    if probe=$(noproxy_env curl -sS --max-time 15 --noproxy '*' -k "https://127.0.0.1:$SERVER_PORT/" 2>&1); then
        if grep -qi 'it works' <<<"$probe"; then
            info "an unauthenticated probe of the server received the decoy site"
        else
            warn "a probe received something unexpected: ${probe:0:120}"
        fi
    else
        warn "the probe check failed: ${probe:0:160}"
    fi
else
    warn "curl not found, skipping the traffic check"
fi

cat <<SUMMARY

  Everything below is live, not a simulation.

  Console      http://127.0.0.1:$CONSOLE_PORT
  Proxy        127.0.0.1:$PROXY_PORT        (SOCKS5 and HTTP on the same port)
  Decoy site   http://127.0.0.1:$DECOY_PORT

  Try it:
    curl -x socks5h://127.0.0.1:$PROXY_PORT https://example.com/   # unset *_proxy first
    curl --noproxy '*' -k https://127.0.0.1:$SERVER_PORT/   # what a prober sees

  Logs are in $DIR. Press Ctrl-C to stop.

SUMMARY

wait
