// PHASE 3B — Production worker configuration fail-closed.
// assertProductionConfig must refuse to start when SMTP_WORKER_URL is
// non-HTTPS (would leak the bearer secret) — except a same-host loopback URL —
// and when SMTP_MODE=remote has no worker URL. Verified via a child process so
// the config singleton is evaluated with fresh env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const CONFIG_URL = pathToFileURL(path.resolve(__dirname, '../../../../config.js')).href;

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
    SMTP_MODE: 'remote',
    SMTP_WORKER_URL: 'https://worker.example.com',
    SMTP_WORKER_SECRET: 'x'.repeat(32),
    DISABLE_RATE_LIMIT: '',
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

test('valid production worker config (HTTPS + secret + remote) starts OK', () => {
  const r = runAssert({});
  assert.equal(r.code, 0, `should start; stderr=${r.stderr}`);
  assert.match(r.stdout, /STARTED_OK/);
});

test('non-HTTPS remote worker URL is REFUSED in production (fail closed)', () => {
  const r = runAssert({ SMTP_WORKER_URL: 'http://worker.example.com' });
  assert.equal(r.code, 1, `should refuse; stderr=${r.stderr}`);
  assert.match(r.stderr, /SMTP_WORKER_URL must use HTTPS/i);
});

test('loopback HTTP worker URL is allowed (same-host deployment)', () => {
  const r = runAssert({ SMTP_WORKER_URL: 'http://127.0.0.1:8090' });
  assert.equal(r.code, 0, `loopback http allowed; stderr=${r.stderr}`);
  assert.match(r.stdout, /STARTED_OK/);
});

test('SMTP_MODE=remote with NO worker URL is refused', () => {
  const r = runAssert({ SMTP_WORKER_URL: '' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /SMTP_MODE=remote requires SMTP_WORKER_URL/i);
});

test('worker secret too short is refused when a worker URL is set', () => {
  const r = runAssert({ SMTP_WORKER_SECRET: 'short' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /SMTP_WORKER_SECRET must be set to a strong value/i);
});
