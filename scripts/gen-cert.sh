#!/usr/bin/env bash
#
# Generate a self-signed certificate and print the pin the client needs.
#
# Use this only when you have no domain. A self-signed certificate makes the
# server stand out from ordinary HTTPS hosts, which is the one thing the design
# is trying to avoid -- prefer a real certificate from Let's Encrypt whenever a
# domain is available. When you must use this, set "pin" in the client config
# so the tunnel is still authenticated.

set -euo pipefail

DOMAIN="${1:-}"
OUT_DIR="${2:-./certs}"

if [[ -z "$DOMAIN" ]]; then
    echo "usage: $0 <domain-or-ip> [output-directory]" >&2
    echo "example: $0 example.com ./certs" >&2
    exit 1
fi

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

mkdir -p "$OUT_DIR"
CERT="$OUT_DIR/cert.pem"
KEY="$OUT_DIR/key.pem"

# An IP needs a different sort of SAN entry than a name does.
if [[ "$DOMAIN" =~ ^[0-9.]+$ || "$DOMAIN" == *:* ]]; then
    SAN="IP:$DOMAIN"
else
    SAN="DNS:$DOMAIN"
fi

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -keyout "$KEY" -out "$CERT" \
    -days 3650 -nodes \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=$SAN" \
    -addext "extendedKeyUsage=serverAuth" \
    2>/dev/null

chmod 600 "$KEY"
chmod 644 "$CERT"

PIN=$(openssl x509 -in "$CERT" -outform der | openssl dgst -sha256 -hex | sed 's/.*= //')

cat <<SUMMARY

Certificate written for $DOMAIN
  certificate : $CERT
  private key : $KEY

Server config:
  "tls": { "cert": "$(realpath "$CERT")", "key": "$(realpath "$KEY")" }

Client config -- this line is required, or the client has no way to tell your
server from anyone who intercepts the connection:
  "pin": "$PIN"

SUMMARY
