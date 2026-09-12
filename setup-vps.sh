#!/usr/bin/env bash
# One-shot setup for running MailHealth on a fresh Ubuntu 22.04/24.04 VPS.
# Run as root:  bash setup-vps.sh
set -euo pipefail

echo "==> MailHealth VPS setup"

# --- 1. Install Node.js 20 + build tools (for better-sqlite3) --------------
if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs build-essential python3
else
  echo "==> Node already installed: $(node -v)"
fi

APP_DIR="/opt/mailhealth"
echo "==> App directory: $APP_DIR"

# --- 2. Install dependencies -----------------------------------------------
cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# --- 3. Create .env if missing ---------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creating .env"
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=3000
JWT_SECRET=$SECRET
COOKIE_SECURE=false
TRUST_PROXY=1

# Live mailbox verification — this is the whole point of the VPS.
SMTP_ENABLED=true
SMTP_FROM=verify@$(hostname -f 2>/dev/null || echo example.com)
SMTP_TIMEOUT_MS=10000
VERIFY_CONCURRENCY=5
EOF
  echo "   .env created with a fresh JWT secret."
fi

# --- 4. Test outbound port 25 ----------------------------------------------
echo "==> Testing outbound port 25 to Gmail..."
if timeout 8 bash -c "echo > /dev/tcp/gmail-smtp-in.l.google.com/25" 2>/dev/null; then
  echo "   ✓ Port 25 is OPEN — live verification will work!"
else
  echo "   ✗ Port 25 appears BLOCKED. Ask your VPS provider to unblock outbound"
  echo "     port 25 (Hetzner/OVH do this on request). Verification will return"
  echo "     'unknown' until it's open."
fi

# --- 5. Install as a systemd service ---------------------------------------
echo "==> Installing systemd service..."
cat > /etc/systemd/system/mailhealth.service <<EOF
[Unit]
Description=MailHealth Email Verification
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mailhealth
systemctl restart mailhealth

echo ""
echo "==> Done! MailHealth is running."
echo "    Check status:  systemctl status mailhealth"
echo "    View logs:     journalctl -u mailhealth -f"
echo "    Open in browser: http://$(curl -s ifconfig.me 2>/dev/null || echo YOUR_SERVER_IP):3000"
echo ""
