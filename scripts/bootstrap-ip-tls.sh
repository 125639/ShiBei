#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "TLS bootstrap installs a root-owned renewal timer; run it with sudo." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

read_dotenv_value() {
  local key="$1" file="$2" line value
  line="$(LC_ALL=C grep -E "^${key}=" "$file" | tail -n 1 || true)"
  value="${line#*=}"
  if [[ ${#value} -ge 2 && "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

STAGING=false
if [[ "${1:-}" == "--staging" ]]; then
  STAGING=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--staging]" >&2
  exit 2
fi

PUBLIC_HOST="$(read_dotenv_value PUBLIC_HOST .env)"
TLS_STATE_DIR="$(read_dotenv_value TLS_STATE_DIR .env)"
TLS_STATE_DIR="${TLS_STATE_DIR:-/var/lib/shibei-tls}"
if [[ ! "$PUBLIC_HOST" =~ ^([A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$ && ! "$PUBLIC_HOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "PUBLIC_HOST is missing or invalid" >&2
  exit 1
fi
if [[ ! "$TLS_STATE_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$TLS_STATE_DIR" == *"/../"* || "$TLS_STATE_DIR" == */.. ]]; then
  echo "TLS_STATE_DIR must be a safe absolute path" >&2
  exit 1
fi

CERT_ROOT="$TLS_STATE_DIR/letsencrypt"
if $STAGING; then CERT_ROOT="${TLS_STATE_DIR}-staging/letsencrypt"; fi
WEB_ROOT="$TLS_STATE_DIR/www"
install -d -o root -g root -m 0700 "$CERT_ROOT"
install -d -o root -g root -m 0755 "$WEB_ROOT"

BOOTSTRAP_CONTAINER="shibei-cert-bootstrap"
cleanup() {
  docker rm -f "$BOOTSTRAP_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

CERT_FILE="$CERT_ROOT/live/$PUBLIC_HOST/fullchain.pem"
if [[ ! -s "$CERT_FILE" ]]; then
  cleanup
  docker run -d --name "$BOOTSTRAP_CONTAINER" \
    -p 80:80 \
    -v "$WEB_ROOT:/usr/share/nginx/html:ro" \
    nginx:1.28-alpine >/dev/null

  CERTBOT_ARGS=(
    certonly
    --webroot
    --webroot-path /var/www/certbot
    --non-interactive
    --agree-tos
    --register-unsafely-without-email
  )
  if [[ "$PUBLIC_HOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    CERTBOT_ARGS+=(--preferred-profile shortlived --ip-address "$PUBLIC_HOST")
  else
    CERTBOT_ARGS+=(--domains "$PUBLIC_HOST")
  fi
  if $STAGING; then CERTBOT_ARGS+=(--staging); fi

  docker run --rm \
    -v "$CERT_ROOT:/etc/letsencrypt" \
    -v "$WEB_ROOT:/var/www/certbot" \
    certbot/certbot:v5.4.0 "${CERTBOT_ARGS[@]}"
fi

if $STAGING; then exit 0; fi

# Release port 80 before the permanent proxy starts. The EXIT trap remains a
# fallback for failures before this point.
cleanup
docker compose --profile https up -d proxy

PROXY_ID="$(docker compose --profile https ps -q proxy)"
PROXY_CONTAINER="$(docker inspect --format '{{.Name}}' "$PROXY_ID" | sed 's#^/##')"
if [[ ! "$PROXY_CONTAINER" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Could not determine the proxy container name" >&2
  exit 1
fi

install -o root -g root -m 0755 \
  "$ROOT_DIR/scripts/renew-tls-certificate.sh" \
  /usr/local/sbin/shibei-renew-tls
umask 077
printf 'PUBLIC_HOST=%s\nTLS_STATE_DIR=%s\nPROXY_CONTAINER=%s\n' \
  "$PUBLIC_HOST" "$TLS_STATE_DIR" "$PROXY_CONTAINER" \
  > /etc/shibei-tls.conf
install -o root -g root -m 0644 \
  "$ROOT_DIR/ops/systemd/shibei-tls-renew.service" \
  /etc/systemd/system/shibei-tls-renew.service
install -o root -g root -m 0644 \
  "$ROOT_DIR/ops/systemd/shibei-tls-renew.timer" \
  /etc/systemd/system/shibei-tls-renew.timer
systemctl daemon-reload
systemctl enable --now shibei-tls-renew.timer
