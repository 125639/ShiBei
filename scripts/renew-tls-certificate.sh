#!/usr/bin/env bash
set -euo pipefail

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

if [[ -z "${PUBLIC_HOST:-}" && -f .env ]]; then
  PUBLIC_HOST="$(read_dotenv_value PUBLIC_HOST .env)"
fi
if [[ -z "${TLS_STATE_DIR:-}" && -f .env ]]; then
  TLS_STATE_DIR="$(read_dotenv_value TLS_STATE_DIR .env)"
fi
TLS_STATE_DIR="${TLS_STATE_DIR:-/var/lib/shibei-tls}"

if [[ ! "${PUBLIC_HOST:-}" =~ ^([A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$ && ! "${PUBLIC_HOST:-}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "PUBLIC_HOST is missing or invalid" >&2
  exit 1
fi
if [[ ! "$TLS_STATE_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$TLS_STATE_DIR" == *"/../"* || "$TLS_STATE_DIR" == */.. ]]; then
  echo "TLS_STATE_DIR must be a safe absolute path" >&2
  exit 1
fi

DOCKER_BIN="$(command -v docker)"
if [[ -z "${PROXY_CONTAINER:-}" ]]; then
  mapfile -t PROXY_CANDIDATES < <("$DOCKER_BIN" ps \
    --filter label=com.docker.compose.service=proxy \
    --format '{{.Names}}')
  if [[ ${#PROXY_CANDIDATES[@]} -ne 1 ]]; then
    echo "Expected exactly one running Compose proxy container" >&2
    exit 1
  fi
  PROXY_CONTAINER="${PROXY_CANDIDATES[0]}"
fi
if [[ ! "$PROXY_CONTAINER" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "PROXY_CONTAINER is invalid" >&2
  exit 1
fi

exec 9>/run/lock/shibei-tls-renew.lock
flock -n 9 || exit 0

mkdir -p "$TLS_STATE_DIR/letsencrypt" "$TLS_STATE_DIR/www"
"$DOCKER_BIN" run --rm \
  -v "$TLS_STATE_DIR/letsencrypt:/etc/letsencrypt" \
  -v "$TLS_STATE_DIR/www:/var/www/certbot" \
  certbot/certbot:v5.4.0 \
  renew --non-interactive --quiet --preferred-profile shortlived

CERT_FILE="$TLS_STATE_DIR/letsencrypt/live/$PUBLIC_HOST/fullchain.pem"
if ! openssl x509 -checkend 172800 -noout -in "$CERT_FILE" >/dev/null; then
  echo "TLS certificate is missing or expires within 48 hours" >&2
  exit 1
fi

# Always validate and reload after a successful Certbot check. If a previous
# reload failed after the files were renewed, the next timer run retries it.
"$DOCKER_BIN" exec "$PROXY_CONTAINER" nginx -t
"$DOCKER_BIN" exec "$PROXY_CONTAINER" nginx -s reload
