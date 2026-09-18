#!/usr/bin/env bash
# MailHealth SMTP worker — one-command bootstrap for a fresh Ubuntu VPS.
#
#   sudo bash setup.sh
#
# It installs Docker, creates smtp-worker/.env (generating a WORKER_SECRET),
# builds the worker, starts it behind Caddy for automatic HTTPS, and then tells
# you whether outbound port 25 actually works on this host.
#
# Non-interactive use (e.g. cloud-init):
#   WORKER_DOMAIN=smtp.example.com SMTP_FROM=verify@example.com sudo -E bash setup.sh
#
# The host must permit OUTBOUND TCP port 25. If the final check says the port is
# blocked, open a support ticket with your VPS provider before going further —
# nothing else in this script will help until that is resolved.
set -euo pipefail

cd "$(dirname "$0")"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || die "Run as root: sudo bash setup.sh"

# --- 1. Gather configuration ------------------------------------------------
if [[ -z "${WORKER_DOMAIN:-}" ]]; then
  read -r -p "Worker hostname (e.g. smtp.yourdomain.com): " WORKER_DOMAIN
fi
[[ -n "${WORKER_DOMAIN:-}" ]] || die "WORKER_DOMAIN is required (used for HTTPS + ACME)."

if [[ -z "${SMTP_FROM:-}" ]]; then
  read -r -p "MAIL FROM address [verify@${WORKER_DOMAIN}]: " SMTP_FROM
  SMTP_FROM="${SMTP_FROM:-verify@${WORKER_DOMAIN}}"
fi

# --- 2. Install Docker if needed -------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  log "Installing the Docker compose plugin"
  apt-get update -y && apt-get install -y docker-compose-plugin
fi

# --- 3. Write .env (never overwrite an existing one) ------------------------
if [[ -f .env ]]; then
  log ".env already exists — leaving it untouched"
  # Pick up WORKER_DOMAIN already in the file so compose stays consistent.
  if [[ -z "${WORKER_DOMAIN:-}" ]]; then
    WORKER_DOMAIN="$(grep -E '^WORKER_DOMAIN=' .env | head -1 | cut -d= -f2- || true)"
  fi
else
  log "Writing .env"
  WORKER_SECRET="${WORKER_SECRET:-$(openssl rand -hex 32)}"
  # NOTE: values are written WITHOUT surrounding quotes — the worker reads
  # process.env directly and does not strip quotes.
  cat > .env <<EOF
NODE_ENV=production
PORT=8090
WORKER_ID=smtp-worker-01
WORKER_REGION=${WORKER_REGION:-default}
WORKER_SECRET=${WORKER_SECRET}
WORKER_DOMAIN=${WORKER_DOMAIN}
SMTP_EHLO=${SMTP_EHLO:-mailhealth.verify}
SMTP_FROM=${SMTP_FROM}
SMTP_TIMEOUT_MS=${SMTP_TIMEOUT_MS:-10000}
SMTP_WORKER_CONCURRENCY=${SMTP_WORKER_CONCURRENCY:-12}
SMTP_MAX_RETRIES=${SMTP_MAX_RETRIES:-2}
WORKER_RATE_LIMIT_PER_MIN=${WORKER_RATE_LIMIT_PER_MIN:-600}
EOF
  chmod 600 .env
fi

# --- 4. Build + start -------------------------------------------------------
log "Building and starting the worker + Caddy"
docker compose up -d --build

# --- 5. Verify outbound port 25 --------------------------------------------
log "Checking outbound port 25 (this is the only thing that can fail)"
ok=""
for _ in $(seq 1 12); do
  sleep 2
  health="$(curl -fsS http://127.0.0.1:8090/health 2>/dev/null || true)"
  if [[ -n "$health" ]]; then
    printf '%s\n' "$health"
    if printf '%s' "$health" | grep -q '"outboundPort25":true'; then ok="yes"; fi
    break
  fi
done

echo
if [[ "$ok" == "yes" ]]; then
  log "SUCCESS — outbound port 25 is OPEN. Live mailbox verification will work."
else
  warn "Could not confirm outbound port 25 (either the container is still starting,"
  warn "or this host blocks it). Check it directly:"
  warn "    docker compose logs --tail=30 smtp-worker"
  warn "    curl -s http://127.0.0.1:8090/health"
  warn "If it reports \"outboundPort25\":false or hangs, your VPS provider is"
  warn "blocking port 25. Open a support ticket to have it lifted (Vultr and"
  warn "Contabo details are in docs/SMTP-WORKER.md) before continuing."
fi

# --- 6. Print the app-side wiring ------------------------------------------
SECRET="$(grep -E '^WORKER_SECRET=' .env | cut -d= -f2- || true)"
cat <<EOF

────────────────────────────────────────────────────────────────────
Next: point your main MailHealth app at this worker.

SMTP_MODE=auto
SMTP_WORKER_URL=https://${WORKER_DOMAIN}
SMTP_WORKER_SECRET=${SECRET}

HTTPS needs an A/AAAA record for ${WORKER_DOMAIN} pointing at this
server, with ports 80 and 443 reachable (Caddy issues the cert).

Then confirm from the app host:
    curl -s https://${WORKER_DOMAIN}/health
    curl -s https://<your-app>/api/health   # verification.mode = "smtp-worker"
────────────────────────────────────────────────────────────────────
EOF
