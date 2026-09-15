// SMTP worker configuration. Read from environment with safe defaults.
// This service is intentionally standalone (its own package.json) so it can be
// deployed to infrastructure that permits outbound TCP port 25, independently
// of the main MailHealth application.

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return String(v).toLowerCase() === 'true';
}
function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

export const config = {
  port: int(process.env.PORT, 8090),
  workerId: process.env.WORKER_ID || 'smtp-worker-01',
  region: process.env.WORKER_REGION || 'default',

  // Shared secret required on POST /internal/verify. The worker refuses to
  // start in production without one, so it can never become an open relay.
  secret: process.env.WORKER_SECRET || '',

  // SMTP conversation.
  ehloName: process.env.SMTP_EHLO || 'mailhealth.verify',
  mailFrom: process.env.SMTP_FROM || 'verify@mailhealth.local',
  connectTimeoutMs: int(process.env.SMTP_TIMEOUT_MS, 10000),
  // MX port to probe. Almost always 25; overridable for testing or unusual MX.
  mxPort: int(process.env.SMTP_MX_PORT, 25),

  // Bounded concurrency so the worker never opens thousands of sockets.
  // Default aligned with the main app's VERIFY_CONCURRENCY (12) so bulk jobs
  // do not queue behind an under-provisioned worker.
  concurrency: int(process.env.SMTP_WORKER_CONCURRENCY, 12),

  // Retry policy for temporary (4xx / greylisting) responses. The worker does
  // NOT block for long retries inside a request; it reports "temporary" and the
  // main app schedules the retry (matching the existing greylist policy).
  maxRetries: int(process.env.SMTP_MAX_RETRIES, 2),

  // Per-IP rate limit for the internal endpoint (defence in depth even though
  // it is authenticated).
  rateLimitPerMin: int(process.env.WORKER_RATE_LIMIT_PER_MIN, 600),

  isProd: (process.env.NODE_ENV || 'development').toLowerCase() === 'production',
};

export function assertConfig() {
  if (config.isProd && !config.secret) {
    console.error('[smtp-worker] Refusing to start: WORKER_SECRET is required in production.');
    process.exit(1);
  }
  if (config.isProd && config.secret.length < 24) {
    console.error('[smtp-worker] Refusing to start: WORKER_SECRET must be at least 24 characters.');
    process.exit(1);
  }
}
