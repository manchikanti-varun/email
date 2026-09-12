import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ROOT, assertProductionConfig } from './config.js';
import { db } from './db.js';

import authRoutes from './routes/auth.js';
import verifyRoutes from './routes/verify.js';
import listRoutes from './routes/lists.js';
import campaignRoutes from './routes/campaign.js';
import integrationRoutes from './routes/integrations.js';
import { resumeJobs, requestQueueStop, isQueueRunning } from './queue.js';
import { startScheduler } from './scheduler.js';
import { loadFeeds } from './verify/data.js';
import { providerName, hasRealProvider } from './verify/providers.js';
import { smtpSelfTest } from './verify/smtp.js';
import {
  requestLogger, errorHandler, notFound,
  apiLimiter, authLimiter, verifyLimiter,
} from './middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fail fast on insecure production config.
assertProductionConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// ---- Security + platform middleware ---------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // The SPA uses inline styles/handlers and inline SVG; allow same-origin
      // scripts + inline styles. No third-party script origins are used.
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(requestLogger);

// CORS: in production lock to configured origins; in dev reflect origin.
app.use(cors({
  origin: config.isProd
    ? (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin / curl
        cb(null, config.corsOrigins.includes(origin));
      }
    : true,
  credentials: true,
}));

app.use(express.json({ limit: config.bodyLimit }));
app.use(cookieParser());

// Verification capability, filled in at boot by the SMTP self-test.
const verifyCapability = {
  liveSmtp: null,          // true | false (set after self-test)
  smtpDetail: 'checking…',
  provider: providerName(),
  realProvider: hasRealProvider(),
};

// ---- Health / readiness ----------------------------------------------------
// Liveness: process is up. Also reports how accurate verification can be here.
app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    service: 'email-list-health',
    env: config.env,
    verification: {
      liveSmtp: verifyCapability.liveSmtp,
      provider: verifyCapability.provider,
      realProvider: verifyCapability.realProvider,
      // The single source of truth about accuracy in this environment.
      mode: verifyCapability.liveSmtp
        ? 'live-smtp'
        : (verifyCapability.realProvider ? 'external-provider' : 'local-only'),
      detail: verifyCapability.smtpDetail,
    },
  }));

// Readiness: dependencies (DB) are usable.
app.get('/api/ready', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ready: true });
  } catch (e) {
    res.status(503).json({ ready: false, error: 'database unavailable' });
  }
});

// ---- API routes (rate limited) --------------------------------------------
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/verify', verifyLimiter, verifyRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/integrations', integrationRoutes);

// ---- Static frontend -------------------------------------------------------
app.use(express.static(path.join(ROOT, 'public'), {
  maxAge: config.isProd ? '1h' : 0,
  setHeaders: (res, filePath) => {
    // index.html must never be cached so deploys take effect immediately.
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// SPA fallback + 404 + error handling.
app.use(notFound);
app.use(errorHandler);

// ---- Boot ------------------------------------------------------------------
loadFeeds();
const server = app.listen(config.port, () => {
  console.log(`\n  Email List Health Platform (${config.env})`);
  console.log(`  → http://localhost:${config.port}`);
  startScheduler();
  resumeJobs();

  // Tell the operator, honestly, how accurate verification will be here.
  smtpSelfTest().then((r) => {
    verifyCapability.liveSmtp = r.available;
    verifyCapability.smtpDetail = r.detail;
    console.log('\n  ── Verification capability ──');
    if (r.available) {
      console.log('  ✓ LIVE SMTP verification is WORKING — results are real (mailbox-level).');
    } else if (hasRealProvider()) {
      console.log(`  ✓ Using external provider "${providerName()}" for mailbox confirmation.`);
      console.log(`  • Live SMTP unavailable: ${r.detail}`);
    } else {
      console.log('  ! Live SMTP is NOT available and no provider is configured.');
      console.log(`    Reason: ${r.detail}`);
      console.log('    → Mailbox existence CANNOT be confirmed here. Addresses that pass');
      console.log('      syntax/DNS/MX will be reported as "unknown", not "safe".');
      console.log('    → For real results: run on a host with outbound port 25 open and set');
      console.log('      SMTP_ENABLED=true, or configure a provider (ZEROBOUNCE_API_KEY).');
    }
    console.log('');
  });
});

// ---- Graceful shutdown -----------------------------------------------------
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received — shutting down gracefully…`);

  requestQueueStop();
  server.close(() => console.log('  HTTP server closed'));

  // Give the in-flight job a short window to finish before forcing exit.
  const deadline = Date.now() + 20000;
  while (isQueueRunning() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    console.log('  Database checkpointed and closed');
  } catch (e) {
    console.error('  DB close error:', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Best-effort flush then exit; a process manager should restart us.
  shutdown('uncaughtException');
});
