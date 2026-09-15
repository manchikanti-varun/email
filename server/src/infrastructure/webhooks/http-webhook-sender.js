// HttpWebhookSender: delivers a standardized JSON payload to a user's matching
// webhooks. Non-blocking. Optionally HMAC-signs the body when a secret is set.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { WebhookSender } from '../../domain/ports/index.js';

// SSRF guard: refuse to deliver webhooks to private/internal destinations.
function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 private ranges
  if (/^(127|10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(h)) return true;
  // 169.254.x.x (link-local / cloud metadata)
  if (/^169\.254\./.test(h)) return true;
  // IPv6 loopback / ULA
  if (/^(\[::1\]|\[::ffff:127|\[0:0:0:0|\[fd|\[fe80)/i.test(h)) return true;
  return false;
}

function post(url, payload, secret) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(false); }
    if (isPrivateHost(u.hostname)) { console.warn(`Webhook blocked (SSRF): ${url}`); return resolve(false); }
    const body = JSON.stringify(payload);
    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : undefined;
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'MailHealth-Webhook/1.0',
          ...(signature ? { 'X-MailHealth-Signature': signature } : {}),
          'X-MailHealth-Event': payload.event,
        },
      },
      (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 300); }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

export class HttpWebhookSender extends WebhookSender {
  /** @param {import('../../domain/ports/index.js').WebhookRepository} webhookRepository */
  constructor(webhookRepository) {
    super();
    this.webhooks = webhookRepository;
  }

  fire(userId, event, data) {
    const hooks = this.webhooks.findMatching(userId, event);
    if (!hooks.length) return;
    const payload = { event, timestamp: new Date().toISOString(), data };
    for (const hook of hooks) {
      post(hook.url, payload, hook.secret).then((ok) => {
        if (!ok) console.warn(`Webhook delivery failed: ${hook.url}`);
      });
    }
  }
}
