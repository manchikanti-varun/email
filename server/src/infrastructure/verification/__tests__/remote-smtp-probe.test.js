import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteSmtpProbe } from '../remote-smtp-probe.js';

function fakeFetch(response, { fail = false } = {}) {
  return async () => {
    if (fail) throw new Error('network');
    return { ok: true, json: async () => response };
  };
}

const base = { url: 'https://worker.test', secret: 'x'.repeat(32), timeoutMs: 2000, maxRetries: 0 };

test('maps accepted -> mailboxExists, source smtp-worker', async () => {
  const p = new RemoteSmtpProbe({ ...base, fetchImpl: fakeFetch({ email: 'a@x.com', smtp: { status: 'accepted', code: 250 }, catchAll: false, worker: { id: 'w1' } }) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.mailboxExists, true);
  assert.equal(r.source, 'smtp-worker');
  assert.equal(r.workerId, 'w1');
});

test('maps rejected -> mailboxRejected', async () => {
  const p = new RemoteSmtpProbe({ ...base, fetchImpl: fakeFetch({ smtp: { status: 'rejected', code: 550 } }) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.mailboxRejected, true);
});

test('maps catch-all -> catchAll + not mailboxExists', async () => {
  const p = new RemoteSmtpProbe({ ...base, fetchImpl: fakeFetch({ smtp: { status: 'catch-all', code: 250 }, catchAll: true }) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.catchAll, true);
  assert.equal(r.mailboxExists, false);
  assert.equal(r.smtpClass, 'catch-all');
});

test('maps temporary -> temporaryFailure + greylisted', async () => {
  const p = new RemoteSmtpProbe({ ...base, fetchImpl: fakeFetch({ smtp: { status: 'temporary', code: 450 } }) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.temporaryFailure, true);
  assert.equal(r.greylisted, true);
});

test('worker status unknown -> inconclusive, NEVER a verdict', async () => {
  const p = new RemoteSmtpProbe({ ...base, fetchImpl: fakeFetch({ smtp: { status: 'unknown', error: 'timeout' } }) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.inconclusive, true);
  assert.equal(r.mxUnreachable, true);
  assert.notEqual(r.mailboxRejected, true);
});

test('sends full mxHosts list to the worker', async () => {
  let body;
  const fetchImpl = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ smtp: { status: 'accepted', code: 250, mxHost: 'mx2.example.com' }, catchAll: false }),
    };
  };
  const p = new RemoteSmtpProbe({ ...base, fetchImpl });
  await p.check('a@x.com', ['mx1.example.com', 'mx2.example.com']);
  assert.deepEqual(body.mxHosts, ['mx1.example.com', 'mx2.example.com']);
  assert.equal(body.mxHost, undefined);
});

test('network failure -> inconclusive, NEVER a verdict', async () => {
  const p = new RemoteSmtpProbe({ ...base, fetchImpl: fakeFetch({}, { fail: true }) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.inconclusive, true);
  assert.equal(r.reachable, false);
});

test('not configured -> inconclusive, source none', async () => {
  const p = new RemoteSmtpProbe({ url: '', secret: '', fetchImpl: fakeFetch({}) });
  const r = await p.check('a@x.com', ['mx']);
  assert.equal(r.inconclusive, true);
  assert.equal(r.source, 'none');
});
