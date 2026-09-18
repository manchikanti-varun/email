# MailHealth SMTP verification worker.
#
# Deploy this ONLY on a host that permits OUTBOUND TCP port 25 (e.g. a
# Hetzner/OVH/Contabo VPS). Do NOT deploy it on Railway/Vercel/Render/Fly —
# they block port 25, so it would report outboundPort25:false and never help.
#
#   docker build -t mailhealth-smtp-worker .
#   docker run -d --name smtp-worker --restart unless-stopped \
#     -p 8090:8090 \
#     -e WORKER_SECRET=<same value as SMTP_WORKER_SECRET in the app> \
#     -e SMTP_FROM=verify@yourdomain.com \
#     -e WORKER_REGION=eu \
#     mailhealth-smtp-worker
#
# Then put it behind HTTPS (Caddy/nginx) and point the main app at it with
# SMTP_WORKER_URL + SMTP_WORKER_SECRET. See ../docs/SMTP-WORKER.md.

FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
COPY package.json ./
RUN npm install --omit=dev

# Application code (secrets excluded via .dockerignore).
COPY . .

# Run unprivileged (the built-in `node` user).
USER node

EXPOSE 8090

# The worker exposes GET /health, which reports outboundPort25.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
