#!/usr/bin/env bash
#
# Turn a fresh Debian/Ubuntu machine into a working veil server, end to end:
# certificate, decoy site, service account, systemd unit, firewall. It finishes
# by printing a client configuration you can paste straight into client.json.
#
# It needs a host that is yours and stays put -- a VPS, a free-tier cloud VM, a
# machine you rent. It cannot be a CI runner or a codespace: those are recycled
# within hours, get a different address every time, and their terms of use do
# not allow running a proxy on them. veil's whole disguise rests on being an
# ordinary long-lived HTTPS host at a name you control.
#
# Usage:
#   sudo ./scripts/bootstrap-vps.sh your-domain.com you@example.com
#
# Before running, point your domain's A record at this machine's public IP.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

CONF_DIR=/etc/veil
DECOY_ROOT=/var/www/decoy
DECOY_PORT=8080
SERVICE_USER=veil

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: sudo $0 <domain> <email>"
[[ -n "$DOMAIN" ]] || die "usage: $0 <domain> <email>"
[[ -n "$EMAIL"  ]] || die "an email is required; Let's Encrypt uses it for expiry warnings"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- sanity: does the domain actually point here? ---------------------------
# Getting this wrong is the most common way the certificate step fails, and the
# error Let's Encrypt returns for it is not obvious, so check first.
info "checking that $DOMAIN resolves to this machine"
public_ip=$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)
if [[ -n "$public_ip" && -n "$resolved" && "$public_ip" != "$resolved" ]]; then
    warn "$DOMAIN resolves to $resolved but this machine appears to be $public_ip"
    warn "if the DNS record was only just changed, wait for it to propagate"
    read -rp "continue anyway? [y/N] " ok
    [[ "$ok" == [yY] ]] || exit 1
elif [[ -z "$resolved" ]]; then
    warn "$DOMAIN does not resolve yet; the certificate step will fail if that does not change"
fi

# --- packages ---------------------------------------------------------------
info "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot golang-go acl curl >/dev/null

go_version=$(go version | awk '{print $3}' | sed 's/go//')
if [[ "$(printf '%s\n1.25\n' "$go_version" | sort -V | head -1)" != "1.25" ]]; then
    warn "the distribution's Go is $go_version but this project needs 1.25+"
    info "installing an up-to-date Go toolchain"
    arch=$(dpkg --print-architecture)
    curl -fsSL "https://go.dev/dl/go1.25.0.linux-${arch}.tar.gz" -o /tmp/go.tgz
    rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz
    export PATH=/usr/local/go/bin:$PATH
fi

# --- build ------------------------------------------------------------------
info "building veil"
make -C "$ROOT" build >/dev/null
install -m 0755 "$ROOT/bin/veil-server" /usr/local/bin/veil-server
install -m 0755 "$ROOT/bin/veil-client" /usr/local/bin/veil-client

id "$SERVICE_USER" &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"

# --- certificate ------------------------------------------------------------
# Port 80 has to be free for the challenge, and nginx is about to want it, so
# take the certificate first with certbot's own temporary listener.
info "obtaining a certificate for $DOMAIN"
systemctl stop nginx 2>/dev/null || true
if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    certbot certonly --standalone --non-interactive --agree-tos \
        -m "$EMAIL" -d "$DOMAIN" || die "certificate issuance failed; check DNS and that port 80 is reachable"
else
    info "an existing certificate for $DOMAIN was found, keeping it"
fi
# The service runs unprivileged, so it needs read access to the key.
setfacl -R -m u:"$SERVICE_USER":rX /etc/letsencrypt/live /etc/letsencrypt/archive

# --- decoy site -------------------------------------------------------------
# This is what an active prober sees. It listens on loopback only; the internet
# reaches it exclusively through veil's fallback, so 443 stays the single open
# port.
info "setting up the decoy site on 127.0.0.1:$DECOY_PORT"
mkdir -p "$DECOY_ROOT"
if [[ ! -f "$DECOY_ROOT/index.html" ]]; then
    cat > "$DECOY_ROOT/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes</title>
<style>
  body { font: 16px/1.7 system-ui, -apple-system, sans-serif; color: #2b3440;
         background: #fbfbfc; margin: 0; }
  main { max-width: 34rem; margin: 12vh auto; padding: 0 1.5rem; }
  h1 { font-size: 1.35rem; margin: 0 0 1rem; }
  p { color: #5b6674; }
  footer { margin-top: 3rem; font-size: .85rem; color: #93a0ae; }
</style>
</head>
<body>
<main>
  <h1>Notes</h1>
  <p>A place to keep things. Nothing published yet.</p>
  <footer>Last updated recently.</footer>
</main>
</body>
</html>
HTML
    warn "the decoy is a placeholder page. Replace $DECOY_ROOT/index.html with"
    warn "something a real person would plausibly host -- it is the only thing a"
    warn "prober ever sees."
fi

cat > /etc/nginx/sites-available/veil-decoy <<CONF
server {
    listen 127.0.0.1:$DECOY_PORT default_server;
    server_name _;
    root $DECOY_ROOT;
    index index.html;
    server_tokens off;

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { try_files \$uri \$uri/ =404; }
}
CONF
ln -sf /etc/nginx/sites-available/veil-decoy /etc/nginx/sites-enabled/veil-decoy
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null || die "the nginx configuration is invalid"
systemctl enable --now nginx >/dev/null
systemctl restart nginx

# --- veil configuration -----------------------------------------------------
install -d -m 0750 -o root -g "$SERVICE_USER" "$CONF_DIR"

if [[ -f "$CONF_DIR/server.json" ]]; then
    info "keeping the existing $CONF_DIR/server.json"
    PASSWORD=$(sed -n 's/.*"password"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONF_DIR/server.json" | head -1)
else
    PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
    cat > "$CONF_DIR/server.json" <<CONF
{
  "listen": ":443",
  "users": [
    { "name": "me", "password": "$PASSWORD" }
  ],
  "tls": {
    "cert": "/etc/letsencrypt/live/$DOMAIN/fullchain.pem",
    "key": "/etc/letsencrypt/live/$DOMAIN/privkey.pem"
  },
  "fallback": "127.0.0.1:$DECOY_PORT",
  "log_level": "info"
}
CONF
    chown root:"$SERVICE_USER" "$CONF_DIR/server.json"
    chmod 0640 "$CONF_DIR/server.json"
fi

veil-server -c "$CONF_DIR/server.json" -check >/dev/null || die "the generated configuration is invalid"

# --- service ----------------------------------------------------------------
info "installing the service"
install -m 0644 "$ROOT/deploy/veil-server.service" /etc/systemd/system/veil-server.service
systemctl daemon-reload
systemctl enable --now veil-server
sleep 2
systemctl is-active --quiet veil-server || {
    journalctl -u veil-server -n 20 --no-pager >&2
    die "veil-server did not start"
}

# Renewal has to tell veil to pick up the new file; a reload is enough, and
# keeps existing connections alive.
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/veil <<'HOOK'
#!/bin/sh
systemctl reload veil-server 2>/dev/null || true
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/veil

# --- firewall ---------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    info "opening ports 80 and 443"
    ufw allow 80/tcp  >/dev/null
    ufw allow 443/tcp >/dev/null
fi

# --- verify -----------------------------------------------------------------
info "checking that a probe of port 443 receives the decoy site"
if probe=$(curl -fsS --max-time 15 "https://$DOMAIN/" 2>&1); then
    if grep -qi '<title>' <<<"$probe"; then
        info "a probe of https://$DOMAIN/ received the decoy site"
    else
        warn "the probe returned something unexpected"
    fi
else
    warn "could not fetch https://$DOMAIN/ from the server itself: $probe"
    warn "this is often just the local network; check from elsewhere"
fi

cat <<SUMMARY

  The server is running. Put this in client.json on your own machine:

{
  "listen": "127.0.0.1:1080",
  "web": { "listen": "127.0.0.1:8088" },
  "servers": [
    {
      "id": "main",
      "name": "$DOMAIN",
      "address": "$DOMAIN:443",
      "password": "$PASSWORD"
    }
  ],
  "auto_connect": "main",
  "route": { "bypass_private": true, "final": "proxy" }
}

  Then run veil-client and open http://127.0.0.1:8088

  Keep that password. Anyone holding it can use this server.
  Server status:  systemctl status veil-server
  Server logs:    journalctl -u veil-server -f

SUMMARY
