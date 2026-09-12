// Outbound webhooks (PDF section 10: integrations for Zapier / Make / CRMs).
// Delivers a standardized JSON payload so downstream tools don't see any
// provider-specific complexity.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { db } from './db.js';

function post(url, payload, secret) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(false); }
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

// Fire all matching webhooks for a user + event. Non-blocking.
export function fireWebhooks(userId, event, data) {
  const hooks = db.prepare(
    "SELECT * FROM webhooks WHERE user_id = ? AND active = 1 AND (event = ? OR event = '*')"
  ).all(userId, event);
  if (!hooks.length) return;

  const payload = { event, timestamp: new Date().toISOString(), data };
  for (const hook of hooks) {
    post(hook.url, payload, hook.secret).then((ok) => {
      if (!ok) console.warn(`Webhook delivery failed: ${hook.url}`);
    });
  }
}
