// MailHealth SMTP Verification Worker.
//
// A small, standalone service that performs recipient-MX SMTP verification on
// behalf of the main MailHealth app. Deploy it where outbound TCP port 25 is
// permitted (e.g. a Hetzner/OVH VPS). The main app calls POST /internal/verify.
//
// It performs NO mail delivery — only EHLO/MAIL FROM/RCPT TO/QUIT — and never
// becomes an open service: every request is authenticated, validated, rate
// limited, and concurrency-bounded.
import express from 'express';
import dns from 'node:dns/promises';

import { config, assertConfig } from './config.js';
import { smtpConversation, classifyCode, isTransportFailure, classifyTransportError } from './smtp-probe.js';
import {
  catchAllAddress, isCatchAll,
  getCachedCatchAll, setCachedCatchAll,
} from './catch-all.js';
import { withRetry, transportErrorRetryable } from './retry.js';
import { makeAuth, makeRateLimiter, validateVerifyBody } from './security.js';
import { metrics, checkOutboundPort25, activeJobs } from './health.js';

assertConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

const auth = makeAuth(config.secret);
const rateLimit = makeRateLimiter({ perMin: config.rateLimitPerMin });

// Bounded concurrency gate so we never open more than N sockets at once.
let inFlight = 0;
const waiters = [];
function acquire() {
  if (inFlight < config.concurrency) { inFlight += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) { inFlight += 1; next(); }
}

// ---- Health ---------------------------------------------------------------
app.get('/health', async (req, res) => {
  let outboundPort25 = null;
  try { outboundPort25 = await checkOutboundPort25(config); } catch { outboundPort25 = false; }
  res.json({
    status: 'healthy',
    smtpEnabled: true,
    outboundPort25,
    workerId: config.workerId,
    region: config.region,
    activeJobs: activeJobs(),
    metrics: metrics.snapshot(),
  });
});

// ---- Verify ---------------------------------------------------------------
// POST /internal/verify  { jobId?, email, mxHost? }
app.post('/internal/verify', rateLimit, auth, async (req, res) => {
  const { valid, errors } = validateVerifyBody(req.body);
  if (!valid) return res.status(400).json({ error: errors.join('; ') });

  const email = String(req.body.email).toLowerCase();
  const domain = email.split('@')[1];

  // Resolve MX list if the caller didn't supply hosts (the main app usually
  // does, to avoid duplicate DNS work — but we support both). Prefer an
  // explicit mxHosts[] so we can fall back when the primary MX is unreachable.
  const MAX_MX_ATTEMPTS = 5;
  let mxHosts = [];
  if (Array.isArray(req.body.mxHosts) && req.body.mxHosts.length) {
    mxHosts = req.body.mxHosts.map(String);
  } else if (req.body.mxHost) {
    mxHosts = [String(req.body.mxHost)];
  } else {
    try {
      const mx = await dns.resolveMx(domain);
      mxHosts = (mx || [])
        .filter((r) => r.exchange)
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange);
    } catch {
      mxHosts = [];
    }
    if (!mxHosts.length) mxHosts = [domain]; // implicit MX
  }
  mxHosts = [...new Set(mxHosts.filter(Boolean))].slice(0, MAX_MX_ATTEMPTS);

  metrics.incActive();
  await acquire();
  try {
    // Skip the random catch-all RCPT when we already know this domain's status.
    const knownCatchAll = getCachedCatchAll(domain);
    const probeAddr = knownCatchAll === null ? catchAllAddress(email) : null;
    const recipients = probeAddr ? [email, probeAddr] : [email];

    const triedHosts = [];
    const mxAttempts = [];
    let conv = null;
    let attempts = 0;
    let mxHost = mxHosts[0];

    // Transport-only fallback across MX hosts. A connected primary that
    // greylists/rejects/accepts is authoritative — do not hop for a different
    // answer. Primary timeout / refused / rate-limited / blocked MUST fall
    // through to the next MX.
    let settledMailbox = null; // { target, targetStatus, catchAll, probeStatus }

    for (const host of mxHosts) {
      mxHost = host;
      triedHosts.push(host);
      const run = await withRetry(
        () => smtpConversation(host, {
          from: config.mailFrom, ehlo: config.ehloName,
          recipients, timeoutMs: config.connectTimeoutMs,
          port: config.mxPort,
        }),
        { maxRetries: config.maxRetries, shouldRetry: transportErrorRetryable },
      );
      conv = run.result;
      attempts += run.attempts;

      if (!conv.connected || isTransportFailure(conv.error)) {
        mxAttempts.push({
          mxHost: host,
          outcome: classifyTransportError(conv.error) || 'unknown',
          error: conv.error || 'connection-failed',
          code: null,
          response: null,
          responseTimeMs: conv.responseTimeMs || 0,
          attempts: run.attempts,
        });
        continue; // try next MX
      }

      const target = conv.rcpt[email] || {};
      const targetStatus = classifyCode(target.code, target.message);

      // Path-level blocks are not mailbox evidence — try the next MX.
      if (targetStatus === 'rate_limited' || targetStatus === 'blocked') {
        mxAttempts.push({
          mxHost: host,
          outcome: targetStatus,
          error: targetStatus,
          code: target.code ?? null,
          response: (target.message || '').slice(0, 200) || null,
          responseTimeMs: conv.responseTimeMs || 0,
          attempts: run.attempts,
        });
        continue;
      }

      let catchAll;
      let probeStatus = null;
      if (probeAddr) {
        const probe = conv.rcpt[probeAddr] || {};
        probeStatus = classifyCode(probe.code, probe.message);
        catchAll = isCatchAll({ targetStatus, probeStatus });
        if (probeStatus === 'accepted' || probeStatus === 'rejected') {
          setCachedCatchAll(domain, catchAll);
        }
      } else {
        catchAll = knownCatchAll;
      }

      mxAttempts.push({
        mxHost: host,
        outcome: catchAll ? 'catch-all' : targetStatus,
        error: null,
        code: target.code ?? null,
        response: (target.message || '').slice(0, 200) || null,
        responseTimeMs: conv.responseTimeMs,
        attempts: run.attempts,
      });

      settledMailbox = { target, targetStatus, catchAll, probeStatus };
      break;
    }

    // Transport failure => evidence about the connection, NOT the mailbox.
    if (!settledMailbox) {
      const evidence = {
        status: 'unknown',
        code: null,
        response: null,
        mxHost,
        triedHosts,
        mxAttempts,
        responseTimeMs: conv?.responseTimeMs || 0,
        error: conv?.error || 'connection-failed',
        errorClass: classifyTransportError(conv?.error) || 'unknown',
        attempts,
      };
      metrics.record({ ...evidence, connected: !!conv?.connected });
      return res.json({
        email,
        smtp: evidence,
        catchAll: false,
        worker: { id: config.workerId, region: config.region },
      });
    }

    const { target, targetStatus, catchAll, probeStatus } = settledMailbox;
    const status = catchAll ? 'catch-all' : targetStatus;

    const evidence = {
      status, // accepted|rejected|temporary|catch-all|unknown
      code: target.code ?? null,
      response: (target.message || '').slice(0, 200) || null,
      mxHost,
      triedHosts,
      mxAttempts,
      responseTimeMs: conv.responseTimeMs,
      attempts,
      probeStatus,
    };
    metrics.record({ ...evidence, connected: true, catchAll });

    res.json({
      email,
      smtp: evidence,
      catchAll: !!catchAll,
      worker: { id: config.workerId, region: config.region },
    });
  } catch (e) {
    res.status(500).json({ error: 'probe_failed', detail: e.message });
  } finally {
    release();
    metrics.decActive();
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Only auto-start the server when run directly (node index.js), not when the
// app is imported by tests. process.argv[1] is the entry script path.
const isDirectRun = process.argv[1] && process.argv[1].endsWith('index.js');
if (isDirectRun) {
  const server = app.listen(config.port, () => {
    console.log(JSON.stringify({
      t: new Date().toISOString(), level: 'info', scope: 'smtp-worker',
      event: 'listening', port: config.port, workerId: config.workerId,
      concurrency: config.concurrency,
    }));
  });
  const shutdown = () => { try { server.close(() => process.exit(0)); } catch { process.exit(0); } setTimeout(() => process.exit(0), 3000); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export { app };
