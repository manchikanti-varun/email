// PHASE 2B.21 — /api/health vs /api/ready semantics.
//   health -> app + verification capability (always 200 with capability block)
//   ready  -> DB/app readiness (200 when DB pingable, 503 when not)
// Builds the REAL Express app via buildApp with a minimal, in-memory container.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

// Minimal container that satisfies buildApp's destructuring without touching
// the real SQLite database or wiring the full stack.
function makeContainer({ dbOk = true } = {}) {
  return {
    config: {
      ROOT: process.cwd(), isProd: false, env: 'test', trustProxy: 0,
      corsOrigins: [], bodyLimit: '1mb', uploadLimitMb: 25,
      cookie: { secure: false, sameSite: 'lax' },
    },
    db: { prepare: () => ({ get: () => { if (!dbOk) throw new Error('database unavailable'); return { 1: 1 }; } }) },
    verifyCapability: {
      liveSmtp: false, provider: 'none', realProvider: false, smtpMode: 'auto',
      smtpSource: 'none', workerConfigured: false, smtpDetail: 'test',
    },
    calibrator: { status: () => ({ available: false }) },
    useCases: {},
    authRequired: (req, res, next) => next(),
    cookies: { setAuthCookie() {}, clearAuthCookie() {} },
  };
}

let server, base;
async function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('GET /api/health -> 200 with verification capability block', async () => {
  const app = buildApp(makeContainer({ dbOk: true }));
  ({ s: server, url: base } = await listen(app));
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.verification, 'health carries a verification capability block');
  assert.equal(body.verification.smtpMode, 'auto');
  assert.equal(body.verification.mode, 'local-only'); // no live smtp / worker / provider
  await new Promise((r) => server.close(r)); server = null;
});

test('GET /api/ready -> 200 when DB is reachable', async () => {
  const app = buildApp(makeContainer({ dbOk: true }));
  ({ s: server, url: base } = await listen(app));
  const res = await fetch(base + '/api/ready');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: true });
  await new Promise((r) => server.close(r)); server = null;
});

test('GET /api/ready -> 503 documented failure when DB ping throws', async () => {
  const app = buildApp(makeContainer({ dbOk: false }));
  ({ s: server, url: base } = await listen(app));
  const res = await fetch(base + '/api/ready');
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ready, false);
  assert.match(body.error, /database unavailable/i);
  await new Promise((r) => server.close(r)); server = null;
});
