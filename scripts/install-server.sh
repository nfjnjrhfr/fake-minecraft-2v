#!/usr/bin/env bash
#
# Install veil-server on a Debian/Ubuntu host: build it, create a service
# account, generate a password, write the config and install the systemd unit.
#
# It does not obtain a certificate and does not install the decoy site; both
# are decisions about your domain that a script should not make for you. The
# summary at the end tells you exactly what is left to do.

set -euo pipefail

PREFIX="${PREFIX:-/usr/local/bin}"
CONF_DIR="${CONF_DIR:-/etc/veil}"
SERVICE_USER="${SERVICE_USER:-veil}"
FALLBACK="${FALLBACK:-127.0.0.1:8080}"

die()  { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "run this as root (sudo $0)"

cd "$(dirname "$0")/.."
command -v go >/dev/null || die "Go is required to build (https://go.dev/dl/)"

info "building"
make build >/dev/null
install -m 0755 bin/veil-server "$PREFIX/veil-server"
install -m 0755 bin/veil-client "$PREFIX/veil-client"

if ! id "$SERVICE_USER" &>/dev/null; then
    info "creating service account $SERVICE_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -m 0750 -o root -g "$SERVICE_USER" "$CONF_DIR"

CONFIG="$CONF_DIR/server.json"
if [[ -f "$CONFIG" ]]; then
    info "keeping the existing $CONFIG"
    PASSWORD="(unchanged)"
else
    PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
    read -rp "domain this server answers for (e.g. example.com): " DOMAIN
    [[ -n "$DOMAIN" ]] || die "a domain is required"

    CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"

    cat > "$CONFIG" <<CONF
{
  "listen": ":443",
  "users": [
    { "name": "me", "password": "$PASSWORD" }
  ],
  "tls": {
    "cert": "$CERT",
    "key": "$KEY"
  },
  "fallback": "$FALLBACK",
  "log_level": "info"
}
CONF
    chown root:"$SERVICE_USER" "$CONFIG"
    chmod 0640 "$CONFIG"
fi

info "installing the systemd unit"
install -m 0644 deploy/veil-server.service /etc/systemd/system/veil-server.service
systemctl daemon-reload

cat <<SUMMARY

Installed. Three things remain, and the server will not start without them.

1. A certificate for your domain:
     apt install certbot
     certbot certonly --standalone -d YOUR-DOMAIN
   Let the veil user read it:
     setfacl -R -m u:$SERVICE_USER:rX /etc/letsencrypt/live /etc/letsencrypt/archive

2. A decoy site on $FALLBACK. Everything that fails authentication is handed
   to it, so it is what a prober sees. deploy/nginx-decoy.conf is a starting
   point. Put something plausible in /var/www/decoy -- a personal page, a
   status page, anything that is not obviously a placeholder.

3. Start it:
     veil-server -c $CONFIG -check
     systemctl enable --now veil-server

Your password (store it somewhere safe, it is not recoverable from here):
  $PASSWORD

SUMMARY
