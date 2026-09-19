// PHASE 2C — Rate-limit production hardening.
//   1) Middleware fail-closed: rateLimitingDisabled() only honors
//      DISABLE_RATE_LIMIT outside production.
//   2) Config fail-fast: assertProductionConfig refuses to start when
//      DISABLE_RATE_LIMIT=true in production (verified via a child process so
//      the config singleton is evaluated with fresh env).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rateLimitingDisabled } from '../middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../../..'); // .../email
// Import specifier must be a file:// URL for the child ESM loader (Windows).
const CONFIG_URL = pathToFileURL(path.resolve(__dirname, '../../../../config.js')).href;

// ---- middleware guard (unit) ----------------------------------------------
test('rateLimitingDisabled: honored in dev/test, IGNORED in production', () => {
  const saveNode = process.env.NODE_ENV;
  const saveFlag = process.env.DISABLE_RATE_LIMIT;
  try {
    // dev + flag => disabled (allowed)
    process.env.NODE_ENV = 'development';
    process.env.DISABLE_RATE_LIMIT = 'true';
    assert.equal(rateLimitingDisabled(), true, 'dev may disable rate limiting');

    // test + flag => disabled (allowed)
    process.env.NODE_ENV = 'test';
    assert.equal(rateLimitingDisabled(), true, 'test may disable rate limiting');

    // production + flag => NOT disabled (fail closed)
    process.env.NODE_ENV = 'production';
    assert.equal(rateLimitingDisabled(), false, 'production must ignore the disable flag');

    // no flag => never disabled
    process.env.NODE_ENV = 'development';
    process.env.DISABLE_RATE_LIMIT = 'false';
    assert.equal(rateLimitingDisabled(), false);
    delete process.env.DISABLE_RATE_LIMIT;
    assert.equal(rateLimitingDisabled(), false);
  } finally {
    if (saveNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saveNode;
    if (saveFlag === undefined) delete process.env.DISABLE_RATE_LIMIT; else process.env.DISABLE_RATE_LIMIT = saveFlag;
  }
});

// Run assertProductionConfig in a child process with a controlled environment.
// Returns { code, stderr }. Uses a strong JWT + webhook key so the ONLY
// production problem under test is the one we inject.
function runAssert(env) {
  const script = `
    import { assertProductionConfig } from ${JSON.stringify(CONFIG_URL)};
    try { assertProductionConfig(); console.log('STARTED_OK'); }
    catch (e) { console.error('THREW:' + e.message); process.exit(3); }
  `;
  const base = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(48),
    WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(64),
    CORS_ORIGINS: 'https://app.example.com',
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'lax',
    SMTP_MODE: 'disabled',
    // Ensure no worker requirement trips the check.
    SMTP_WORKER_URL: '',
    DATA_DIR: path.join(REPO_ROOT, 'data'),
  };
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...base, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// ---- config fail-fast (child process) -------------------------------------
test('assertProductionConfig: DISABLE_RATE_LIMIT=true in production refuses to start (exit 1)', () => {
  const r = runAssert({ DISABLE_RATE_LIMIT: 'true' });
  assert.equal(r.code, 1, `should process.exit(1); got code ${r.code}. stderr=${r.stderr}`);
  assert.match(r.stderr, /DISABLE_RATE_LIMIT must not be set in production/i);
});

test('assertProductionConfig: valid production config (no disable flag) starts OK', () => {
  const r = runAssert({ DISABLE_RATE_LIMIT: 'false' });
  assert.equal(r.code, 0, `should start; stderr=${r.stderr}`);
  assert.match(r.stdout, /STARTED_OK/);
});

test('assertProductionConfig: DISABLE_RATE_LIMIT unset in production starts OK', () => {
  const r = runAssert({ DISABLE_RATE_LIMIT: '' });
  assert.equal(r.code, 0, `should start; stderr=${r.stderr}`);
  assert.match(r.stdout, /STARTED_OK/);
});
