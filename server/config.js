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
    timeoutMs: parseInt(process.env.SMTP_TIMEOUT_MS || '8000', 10),
  },
  verifyConcurrency: parseInt(process.env.VERIFY_CONCURRENCY || '5', 10),
  bodyLimit: process.env.BODY_LIMIT || '2mb',
  uploadLimitMb: parseInt(process.env.UPLOAD_LIMIT_MB || '25', 10),
  // Starting credits for a newly-registered account.
  signupCredits: parseInt(process.env.SIGNUP_CREDITS || '1000', 10),
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
  if (problems.length) {
    console.error('\n  Refusing to start — insecure production configuration:');
    for (const p of problems) console.error('   - ' + p);
    console.error('\n  Generate a secret with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
    process.exit(1);
  }
}
