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
import { smtpConversation, classifyCode, isTransportFailure } from './smtp-probe.js';
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

  // Resolve MX if the caller didn't supply one (the main app usually does, to
  // avoid duplicate DNS work — but we support both).
  let mxHost = req.body.mxHost;
  if (!mxHost) {
    try {
      const mx = await dns.resolveMx(domain);
      const sorted = (mx || []).filter((r) => r.exchange).sort((a, b) => a.priority - b.priority);
      mxHost = sorted[0]?.exchange || domain;
    } catch {
      mxHost = domain; // implicit MX
    }
  }

  metrics.incActive();
  await acquire();
  try {
    // Skip the random catch-all RCPT when we already know this domain's status.
    const knownCatchAll = getCachedCatchAll(domain);
    const probeAddr = knownCatchAll === null ? catchAllAddress(email) : null;
    const recipients = probeAddr ? [email, probeAddr] : [email];

    const { result: conv, attempts } = await withRetry(
      () => smtpConversation(mxHost, {
        from: config.mailFrom, ehlo: config.ehloName,
        recipients, timeoutMs: config.connectTimeoutMs,
        port: config.mxPort,
      }),
      { maxRetries: config.maxRetries, shouldRetry: transportErrorRetryable },
    );

    // Transport failure => evidence about the connection, NOT the mailbox.
    if (!conv.connected || isTransportFailure(conv.error)) {
      const evidence = {
        status: 'unknown',
        code: null,
        response: null,
        mxHost,
        responseTimeMs: conv.responseTimeMs,
        error: conv.error || 'connection-failed',
        attempts,
      };
      metrics.record({ ...evidence, connected: conv.connected });
      return res.json({
        email,
        smtp: evidence,
        catchAll: false,
        worker: { id: config.workerId, region: config.region },
      });
    }

    const target = conv.rcpt[email] || {};
    const targetStatus = classifyCode(target.code);
    let catchAll;
    if (probeAddr) {
      const probe = conv.rcpt[probeAddr] || {};
      const probeStatus = classifyCode(probe.code);
      catchAll = isCatchAll({ targetStatus, probeStatus });
      // Only cache confident accept/reject of the random probe, not temp/no-reply.
      if (probeStatus === 'accepted' || probeStatus === 'rejected') {
        setCachedCatchAll(domain, catchAll);
      }
    } else {
      catchAll = knownCatchAll;
    }

    const evidence = {
      status: catchAll ? 'catch-all' : targetStatus, // accepted|rejected|temporary|catch-all|unknown
      code: target.code ?? null,
      response: (target.message || '').slice(0, 200) || null,
      mxHost,
      responseTimeMs: conv.responseTimeMs,
      attempts,
    };
    metrics.record({ ...evidence, connected: true, catchAll });

    res.json({
      email,
      smtp: evidence,
      catchAll,
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
