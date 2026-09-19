// Central configuration, read from environment with sensible defaults.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Lightweight .env loader (avoids adding a dependency). Loads .env, and in
// production also allows a .env.production to take precedence.
function loadDotEnv() {
  const candidates = ['.env'];
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    candidates.unshift('.env.production');
  }
  for (const file of candidates) {
    const envPath = path.join(ROOT, file);
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      val = val.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}
loadDotEnv();

// Normalise quoted environment values.
//
// Some deployment platforms store `KEY="value"` with the quote characters as
// part of the value, so Node hands the app `"value"` (quotes included). That
// silently breaks typed settings: `SMTP_ENABLED="true"` reads as false,
// `COOKIE_SECURE="true"` reads as false, `SMTP_TIMEOUT_MS="5000"` becomes NaN,
// and `DATA_DIR="/data"` writes the database outside the mounted volume.
//
// The .env file loader below already strips surrounding quotes from file
// values; this makes platform-set variables behave identically, regardless of
// whether the quotes came from a .env file, a Docker `-e KEY="..."`, or a
// dashboard paste. Only a single matching pair of surrounding quotes is
// removed — values that merely contain quotes are untouched.
function normalizeQuotedEnv() {
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || value.length < 2) continue;
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      process.env[key] = value.slice(1, -1);
    }
  }
}
normalizeQuotedEnv();

const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
const isProd = nodeEnv === 'production';

const DEFAULT_SECRETS = new Set([
  'dev-insecure-secret-change-me',
  'dev-local-secret-change-me',
  'change-me-in-production',
  '',
]);

function bool(v, dflt) {
  if (v === undefined) return dflt;
  return String(v).toLowerCase() === 'true';
}

export const config = {
  env: nodeEnv,
  isProd,
  port: parseInt(process.env.PORT || '3000', 10),
  // Behind a reverse proxy (nginx/Caddy/Fly/Render) so secure cookies + rate
  // limiting use the real client IP. Number of proxy hops to trust.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : (isProd ? 1 : 0),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  // Comma-separated list of allowed browser origins in production.
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  publicUrl: process.env.PUBLIC_URL || '',
  cookie: {
    secure: bool(process.env.COOKIE_SECURE, isProd),
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
  },
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  get dbPath() { return path.join(this.dataDir, 'app.db'); },
  smtp: {
    enabled: bool(process.env.SMTP_ENABLED, true),
    from: process.env.SMTP_FROM || 'verify@example.com',
    timeoutMs: parseInt(process.env.SMTP_TIMEOUT_MS || '6000', 10),
    // Bounded transport retries (connection refused/reset). Timeouts are not
    // retried in-request — they fall through to the next MX / vantage instead.
    maxRetries: parseInt(process.env.SMTP_MAX_RETRIES || '1', 10),
    // Per-domain minimum interval between SMTP probes (rate limit).
    domainMinIntervalMs: parseInt(process.env.SMTP_DOMAIN_MIN_INTERVAL_MS || '80', 10),
    // Short-TTL cache for conclusive SMTP answers (accepted/rejected/catch-all).
    cacheTtlMs: parseInt(process.env.SMTP_CACHE_TTL_MS || String(10 * 60 * 1000), 10),
    // SMTP routing mode: 'auto' (default) tries local port 25 and falls back to
    // the MailHealth SMTP worker; 'local' uses only the local socket probe;
    // 'remote' always uses the worker; 'disabled' performs no SMTP probing.
    // The main app does NOT require outbound port 25 in 'remote'/'auto'-with-worker.
    mode: (process.env.SMTP_MODE || 'auto').toLowerCase(),
  },
  // Encryption key for webhook signing-secrets at rest (AES-256-GCM). Must be
  // 32 bytes, supplied as 64 hex chars or 44-char base64. Kept OUTSIDE the
  // database. In development a deterministic key is derived from JWT_SECRET so
  // local setups work without extra config; production REQUIRES an explicit,
  // high-entropy key (enforced in assertProductionConfig).
  webhookEncryptionKey: (process.env.WEBHOOK_ENCRYPTION_KEY || '').trim(),

  // MailHealth-owned SMTP verification worker (see smtp-worker/). Runs where
  // outbound port 25 is permitted. No third-party verification API involved.
  smtpWorker: {
    url: (process.env.SMTP_WORKER_URL || '').replace(/\/$/, ''),
    secret: process.env.SMTP_WORKER_SECRET || '',
    timeoutMs: parseInt(process.env.SMTP_WORKER_TIMEOUT_MS || '12000', 10),
    maxRetries: parseInt(process.env.SMTP_WORKER_MAX_RETRIES || '1', 10),
  },
  verifyConcurrency: parseInt(process.env.VERIFY_CONCURRENCY || '12', 10),
  bodyLimit: process.env.BODY_LIMIT || '2mb',
  uploadLimitMb: parseInt(process.env.UPLOAD_LIMIT_MB || '25', 10),
  // Starting credits for a newly-registered account.
  signupCredits: parseInt(process.env.SIGNUP_CREDITS || '1000', 10),

  // ---- AI Agent (optional intelligence/orchestration layer) --------------
  // The agent is ON by default. With no AI_PROVIDER/AI_API_KEY/AI_MODEL set it
  // runs in heuristic (no-LLM) mode — deterministic tool selection with NO
  // external calls. Set AI_ENABLED=false to disable the /api/agent endpoint
  // entirely. Configure a provider + key + model to enable real LLM planning.
  // The deterministic verification engine remains the sole source of truth
  // regardless of this setting.
  ai: {
    enabled: bool(process.env.AI_ENABLED, true),
    // Provider adapter: 'openai' | 'anthropic' | 'openai-compatible'. Empty ->
    // the agent runs in heuristic (no-LLM) planning mode when AI_ENABLED=true.
    provider: (process.env.AI_PROVIDER || '').trim().toLowerCase(),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
    // Custom base URL for self-hosted / OpenAI-compatible gateways.
    baseUrl: (process.env.AI_BASE_URL || '').replace(/\/$/, ''),
    // Runtime safety limits.
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '20000', 10),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || '2', 10),
    maxIterations: parseInt(process.env.AI_MAX_ITERATIONS || '10', 10),
    // Per-user requests allowed inside the agent rate window (per minute).
    rateLimitPerMin: parseInt(process.env.AI_RATE_LIMIT_PER_MIN || '20', 10),
    // Cost estimate ($ per 1K input / output tokens). Used for cost tracking
    // only — never for billing. Defaults approximate gpt-4o-mini.
    costPer1kInput: parseFloat(process.env.AI_COST_PER_1K_INPUT || '0.00015'),
    costPer1kOutput: parseFloat(process.env.AI_COST_PER_1K_OUTPUT || '0.0006'),
    // Show the user an estimated cost when a verification would spend at
    // least this many credits without prior confirmation.
    confirmSpendThreshold: parseInt(process.env.AI_CONFIRM_SPEND_THRESHOLD || '50', 10),
  },
};

// Ensure data directory exists.
fs.mkdirSync(config.dataDir, { recursive: true });

// ---- Production safety checks ---------------------------------------------
// Fail fast rather than run insecurely. These only throw in production so the
// dev experience stays frictionless.
export function assertProductionConfig() {
  if (!isProd) return;
  const problems = [];
  if (DEFAULT_SECRETS.has(config.jwtSecret) || config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a strong random value (>= 32 chars) in production.');
  }
  if (config.corsOrigins.length === 0) {
    // Not fatal, but warn loudly: with no explicit origins we deny cross-origin.
    console.warn('  [warn] CORS_ORIGINS is empty; cross-origin browser requests will be blocked.');
  }
  if (!config.cookie.secure) {
    console.warn('  [warn] COOKIE_SECURE is false in production; cookies will be sent over HTTP.');
  }
  // Cross-domain cookies (frontend + backend on different domains) require
  // SameSite=None, which browsers only honour when the cookie is also Secure.
  if (config.cookie.sameSite.toLowerCase() === 'none' && !config.cookie.secure) {
    problems.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject insecure SameSite=None cookies).');
  }
  // If a worker URL is configured, it must be HTTPS and carry a strong secret.
  if (config.smtpWorker.url) {
    // Fail closed on an insecure worker URL: the bearer secret travels on this
    // hop, so plaintext HTTP to anything but a same-host loopback address would
    // leak it. A loopback URL (same-box deployment) is the only permitted
    // non-HTTPS case in production.
    const isHttps = /^https:\/\//i.test(config.smtpWorker.url);
    let host = '';
    try { host = new URL(config.smtpWorker.url).hostname.toLowerCase(); } catch { host = ''; }
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (!isHttps && !isLoopback) {
      problems.push('SMTP_WORKER_URL must use HTTPS in production (plaintext HTTP would leak the worker bearer secret).');
    }
    if (!config.smtpWorker.secret || config.smtpWorker.secret.length < 24) {
      problems.push('SMTP_WORKER_SECRET must be set to a strong value (>= 24 chars) when SMTP_WORKER_URL is configured.');
    }
  }
  if (config.smtp.mode === 'remote' && !config.smtpWorker.url) {
    problems.push('SMTP_MODE=remote requires SMTP_WORKER_URL to be set.');
  }
  // Rate limiting must never be silently disabled in production. Refuse to
  // start rather than run an unthrottled, brute-forceable API.
  if (String(process.env.DISABLE_RATE_LIMIT).toLowerCase() === 'true') {
    problems.push('DISABLE_RATE_LIMIT must not be set in production (rate limiting cannot be disabled in prod).');
  }
  // Webhook signing-secrets are encrypted at rest with this key; production
  // must not fall back to the JWT-derived dev key. Require 32 bytes (64 hex or
  // 32-byte base64).
  {
    const k = config.webhookEncryptionKey;
    const isHex64 = /^[0-9a-fA-F]{64}$/.test(k);
    let isB64_32 = false;
    try { isB64_32 = Buffer.from(k, 'base64').length === 32; } catch { isB64_32 = false; }
    if (!k) {
      problems.push('WEBHOOK_ENCRYPTION_KEY must be set in production (32 bytes as 64 hex chars or base64).');
    } else if (!isHex64 && !isB64_32) {
      problems.push('WEBHOOK_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 32-byte base64).');
    }
  }
  // Diagnose the most common cause of "every contact is Unknown": SMTP probing
  // is enabled but there is no configured path that can open a connection when
  // this host blocks outbound port 25. Not fatal (a local-only or provider-based
  // setup is legitimate), but it must be loud, because the failure mode is
  // otherwise invisible: syntax/DNS/MX all pass and results silently stay
  // Unknown. See docs/SMTP-WORKER.md.
  if (config.smtp.enabled && config.smtp.mode !== 'disabled' && !config.smtpWorker.url) {
    console.warn(
      `  [warn] SMTP probing is enabled (SMTP_MODE=${config.smtp.mode}) but SMTP_WORKER_URL is not set.`
    );
    console.warn(
      '         If this host blocks outbound port 25, every address that passes syntax/DNS/MX will be reported as "unknown".'
    );
    console.warn(
      '         Fix: deploy smtp-worker/ on a host with port 25 open and set SMTP_WORKER_URL + SMTP_WORKER_SECRET.'
    );
  }
  if (problems.length) {
    console.error('\n  Refusing to start — insecure production configuration:');
    for (const p of problems) console.error('   - ' + p);
    console.error('\n  Generate a secret with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
    process.exit(1);
  }
}
