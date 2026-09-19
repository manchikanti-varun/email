// PHASE 3B — SMTP_MODE routing regression.
// Confirms that in production worker-only mode (SMTP_MODE=remote) the router
// uses the worker exclusively and NEVER invokes the local port-25 probe, and
// that worker failures degrade to inconclusive (engine -> UNKNOWN), never a
// negative mailbox verdict. Also re-pins local/disabled routing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmtpRouter } from '../smtp-router.js';

// A local probe that FAILS the test if it is ever called (proves remote mode
// never opens local :25).
function forbiddenLocal() {
  return {
    check: async () => { throw new Error('local probe MUST NOT be called in remote mode'); },
    selfTest: async () => { throw new Error('local selfTest MUST NOT be called in remote mode'); },
  };
}
function remote(result, { healthy = true, onCheck } = {}) {
  return {
    configured: true,
    check: async (email, mx) => { onCheck?.(email, mx); return { ...result, source: 'smtp-worker' }; },
    health: async () => ({ available: healthy }),
    selfTest: async () => ({ available: healthy, reason: 'ok', detail: 'worker' }),
  };
}

test('SMTP_MODE=remote: uses the worker and NEVER calls the local probe', async () => {
  let workerCalled = false;
  const r = new SmtpRouter({
    mode: 'remote',
    local: forbiddenLocal(),
    remote: remote({ reachable: true, mailboxExists: true }, { onCheck: () => { workerCalled = true; } }),
  });
  const out = await r.check('a@example.com', ['mx1.example.com']);
  assert.equal(workerCalled, true, 'worker was used');
  assert.equal(out.source, 'smtp-worker');
  assert.equal(out.mailboxExists, true);
});

test('SMTP_MODE=remote: worker 550 -> mailboxRejected (engine -> UNDELIVERABLE)', async () => {
  const r = new SmtpRouter({ mode: 'remote', local: forbiddenLocal(), remote: remote({ reachable: true, mailboxRejected: true, code: 550 }) });
  const out = await r.check('a@example.com', ['mx']);
  assert.equal(out.mailboxRejected, true);
  assert.notEqual(out.mailboxExists, true);
});

test('SMTP_MODE=remote: worker temporary (4xx) -> temporaryFailure (engine -> UNKNOWN)', async () => {
  const r = new SmtpRouter({ mode: 'remote', local: forbiddenLocal(), remote: remote({ reachable: true, temporaryFailure: true }) });
  const out = await r.check('a@example.com', ['mx']);
  assert.equal(out.temporaryFailure, true);
  assert.notEqual(out.mailboxRejected, true);
});

test('SMTP_MODE=remote: worker unavailable (inconclusive) -> NOT a negative verdict (UNKNOWN)', async () => {
  // RemoteSmtpProbe returns reachable:false/inconclusive on worker failure.
  const r = new SmtpRouter({ mode: 'remote', local: forbiddenLocal(), remote: remote({ reachable: false, inconclusive: true, error: 'worker-timeout' }) });
  const out = await r.check('a@example.com', ['mx']);
  assert.notEqual(out.mailboxExists, true);
  assert.notEqual(out.mailboxRejected, true);
});

test('SMTP_MODE=remote: catch-all evidence preserved (engine -> ACCEPT_ALL)', async () => {
  const r = new SmtpRouter({ mode: 'remote', local: forbiddenLocal(), remote: remote({ reachable: true, catchAll: true }) });
  const out = await r.check('a@example.com', ['mx']);
  assert.equal(out.catchAll, true);
  assert.notEqual(out.mailboxExists, true, 'catch-all must not set mailboxExists');
});

test('SMTP_MODE=disabled: skipped, never calls local or remote', async () => {
  const r = new SmtpRouter({
    mode: 'disabled',
    local: forbiddenLocal(),
    remote: { configured: true, check: async () => { throw new Error('remote MUST NOT be called when disabled'); }, health: async () => ({ available: true }) },
  });
  const out = await r.check('a@example.com', ['mx']);
  assert.equal(out.skipped, true);
});

test('SMTP_MODE=local: uses the local probe only (worker never called)', async () => {
  let localCalled = false;
  const r = new SmtpRouter({
    mode: 'local',
    local: { check: async () => { localCalled = true; return { reachable: true, mailboxExists: true }; }, selfTest: async () => ({ available: true }) },
    remote: { configured: true, check: async () => { throw new Error('worker MUST NOT be called in local mode'); }, health: async () => ({ available: true }) },
  });
  const out = await r.check('a@example.com', ['mx']);
  assert.equal(localCalled, true);
  assert.equal(out.source, 'local-smtp');
});
