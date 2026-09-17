// Worker security middleware: bearer-token auth, request validation, and a
// simple in-process per-IP rate limiter. The worker must never become an open
// SMTP-scanning service, so every /internal/* request is authenticated and
// validated.
import crypto from 'node:crypto';

// Constant-time bearer check against the configured secret.
export function makeAuth(secret) {
  return function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!secret || !token || !safeEqual(token, secret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const HOST_RE = /^[a-z0-9.-]{1,255}$/i;

// Validate the verify request body. Rejects malformed input before any socket
// is opened, preventing the worker from being used to probe arbitrary targets
// with junk data.
export function validateVerifyBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { valid: false, errors: ['body required'] };
  if (!EMAIL_RE.test(String(body.email || ''))) errors.push('valid email required');
  if (body.mxHost !== undefined && body.mxHost !== null && !HOST_RE.test(String(body.mxHost))) {
    errors.push('mxHost must be a hostname');
  }
  if (body.mxHosts !== undefined && body.mxHosts !== null) {
    if (!Array.isArray(body.mxHosts)) {
      errors.push('mxHosts must be an array of hostnames');
    } else if (body.mxHosts.length > 5) {
      errors.push('mxHosts supports at most 5 hosts');
    } else {
      for (const h of body.mxHosts) {
        if (!HOST_RE.test(String(h || ''))) {
          errors.push('mxHosts entries must be hostnames');
          break;
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function makeRateLimiter({ perMin }) {
  const hits = new Map(); // ip -> [timestamps]
  let lastSweep = Date.now();

  // Periodic cleanup to prevent unbounded memory growth from abandoned IPs.
  function sweep() {
    const now = Date.now();
    if (now - lastSweep < 120_000) return; // every 2 minutes
    lastSweep = now;
    for (const [ip, arr] of hits) {
      const fresh = arr.filter((t) => now - t < 60_000);
      if (fresh.length === 0) hits.delete(ip);
      else hits.set(ip, fresh);
    }
  }

  return function rateLimit(req, res, next) {
    sweep();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > perMin) return res.status(429).json({ error: 'Rate limit exceeded' });
    next();
  };
}
