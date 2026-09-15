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
    // SMTP routing mode: 'auto' (default) tries local port 25 and falls back to
    // the MailHealth SMTP worker; 'local' uses only the local socket probe;
    // 'remote' always uses the worker; 'disabled' performs no SMTP probing.
    // The main app does NOT require outbound port 25 in 'remote'/'auto'-with-worker.
    mode: (process.env.SMTP_MODE || 'auto').toLowerCase(),
  },
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
    if (!/^https:\/\//i.test(config.smtpWorker.url)) {
      console.warn('  [warn] SMTP_WORKER_URL is not HTTPS; worker traffic (incl. the bearer secret) would be sent in the clear.');
    }
    if (!config.smtpWorker.secret || config.smtpWorker.secret.length < 24) {
      problems.push('SMTP_WORKER_SECRET must be set to a strong value (>= 24 chars) when SMTP_WORKER_URL is configured.');
    }
  }
  if (config.smtp.mode === 'remote' && !config.smtpWorker.url) {
    problems.push('SMTP_MODE=remote requires SMTP_WORKER_URL to be set.');
  }
  if (problems.length) {
    console.error('\n  Refusing to start — insecure production configuration:');
    for (const p of problems) console.error('   - ' + p);
    console.error('\n  Generate a secret with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
    process.exit(1);
  }
}
