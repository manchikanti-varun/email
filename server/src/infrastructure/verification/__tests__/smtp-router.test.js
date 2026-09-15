import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmtpRouter } from '../smtp-router.js';

// Fake probes implementing check()/selfTest()/health().
function fakeLocal(result) {
  return { check: async () => ({ ...result }), selfTest: async () => ({ available: result.reachable === true, reason: 'ok', detail: 'local' }) };
}
function fakeRemote(result, { healthy = true, configured = true } = {}) {
  return {
    configured,
    check: async () => ({ ...result, source: 'smtp-worker' }),
    health: async () => ({ available: healthy }),
    selfTest: async () => ({ available: healthy, reason: healthy ? 'ok' : 'down', detail: 'worker' }),
  };
}

const ACCEPT = { reachable: true, mailboxExists: true };
const BLOCKED = { reachable: false, error: 'timeout', inconclusive: true };

test('mode=disabled -> skipped (engine yields unknown)', async () => {
  const r = new SmtpRouter({ mode: 'disabled', local: fakeLocal(ACCEPT), remote: fakeRemote(ACCEPT) });
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(out.skipped, true);
});

test('mode=local -> uses local, tagged local-smtp', async () => {
  const r = new SmtpRouter({ mode: 'local', local: fakeLocal(ACCEPT), remote: fakeRemote(BLOCKED) });
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(out.mailboxExists, true);
  assert.equal(out.source, 'local-smtp');
});

test('mode=remote -> always worker', async () => {
  const r = new SmtpRouter({ mode: 'remote', local: fakeLocal(ACCEPT), remote: fakeRemote({ reachable: true, mailboxRejected: true }) });
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(out.source, 'smtp-worker');
  assert.equal(out.mailboxRejected, true);
});

test('auto: local conclusive -> use local, do not call worker', async () => {
  let workerCalled = false;
  const remote = fakeRemote(ACCEPT);
  remote.check = async () => { workerCalled = true; return { reachable: true, mailboxExists: true, source: 'smtp-worker' }; };
  const r = new SmtpRouter({ mode: 'auto', local: fakeLocal(ACCEPT), remote });
  // After self-test confirms local port 25, prefer local over worker.
  r.setLocalPort25(true);
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(out.source, 'local-smtp');
  assert.equal(workerCalled, false);
});

test('auto: local blocked + healthy worker -> use worker', async () => {
  const r = new SmtpRouter({ mode: 'auto', local: fakeLocal(BLOCKED), remote: fakeRemote(ACCEPT, { healthy: true }) });
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(out.source, 'smtp-worker');
  assert.equal(out.mailboxExists, true);
});

test('auto: local blocked + no worker -> skipped (unknown), NEVER invalid', async () => {
  const r = new SmtpRouter({ mode: 'auto', local: fakeLocal(BLOCKED), remote: fakeRemote(ACCEPT, { configured: false }) });
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(out.skipped === true || out.inconclusive === true, true);
  assert.notEqual(out.mailboxRejected, true); // must not fabricate a negative verdict
});

test('auto: local blocked + worker also down -> falls back to inconclusive local', async () => {
  const r = new SmtpRouter({ mode: 'auto', local: fakeLocal(BLOCKED), remote: fakeRemote(BLOCKED, { healthy: false }) });
  const out = await r.check('a@x.com', ['mx']);
  assert.notEqual(out.mailboxExists, true);
  assert.notEqual(out.mailboxRejected, true);
});

test('learns local port 25 is blocked and skips it next time', async () => {
  let localCalls = 0;
  const local = { check: async () => { localCalls++; return { reachable: false, error: 'timeout', inconclusive: true }; }, selfTest: async () => ({ available: false }) };
  let healthy = false;
  const remote = {
    configured: true,
    check: async () => ({ ...ACCEPT, source: 'smtp-worker' }),
    health: async () => ({ available: healthy }),
    selfTest: async () => ({ available: healthy, reason: 'ok', detail: 'worker' }),
  };
  const r = new SmtpRouter({ mode: 'auto', local, remote });
  // Worker down while local capability unknown → try local and learn blocked.
  await r.check('a@x.com', ['mx']);
  healthy = true;
  r._workerHealth = { at: 0, available: null };
  await r.check('b@x.com', ['mx']); // must skip local now
  assert.equal(localCalls, 1);
});

test('auto: while local port 25 is still unknown, prefer healthy worker', async () => {
  let localCalls = 0;
  const local = {
    check: async () => { localCalls++; return { reachable: true, mailboxExists: true }; },
    selfTest: async () => ({ available: true }),
  };
  const r = new SmtpRouter({ mode: 'auto', local, remote: fakeRemote(ACCEPT, { healthy: true }) });
  // _localPort25 stays null (self-test not run) — must not probe local first.
  const out = await r.check('a@x.com', ['mx']);
  assert.equal(localCalls, 0);
  assert.equal(out.mailboxExists, true);
  assert.equal(out.source, 'smtp-worker');
});
