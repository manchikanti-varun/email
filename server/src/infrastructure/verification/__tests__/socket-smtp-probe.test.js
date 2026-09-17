// Unit tests for SocketSmtpProbe catch-all memoization and multi-MX fallback
// (no network — probeFn is injected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocketSmtpProbe, MAX_MX_ATTEMPTS } from '../socket-smtp-probe.js';

function probe(probeFn) {
  return new SocketSmtpProbe({
    enabled: true,
    from: 'verify@example.com',
    timeoutMs: 1000,
    probeFn,
  });
}

test('catch-all cache: miss returns null, hit returns stored boolean', () => {
  const p = probe(async () => ({ connected: false, rcpt: {}, error: 'timeout' }));
  assert.equal(p._catchAllCached('example.com'), null);
  p._setCatchAll('example.com', false);
  assert.equal(p._catchAllCached('example.com'), false);
  p._setCatchAll('catch.com', true);
  assert.equal(p._catchAllCached('catch.com'), true);
});

test('catch-all cache: expired entry is treated as unknown', () => {
  const p = probe(async () => ({ connected: false, rcpt: {}, error: 'timeout' }));
  p._catchAll.set('old.com', { at: Date.now() - 11 * 60 * 1000, isCatchAll: true });
  assert.equal(p._catchAllCached('old.com'), null);
});

test('MX fallback: primary transport failure -> secondary success', async () => {
  const calls = [];
  const p = probe(async (host, _from, recipients) => {
    calls.push(host);
    if (host === 'nsmtp.example.com') {
      return { connected: false, rcpt: {}, error: 'timeout' };
    }
    const email = recipients[0];
    return { connected: true, greeting: 220, rcpt: { [email]: 250 }, error: null };
  });

  // Pre-seed catch-all so the probe does not invent a random second recipient.
  p._setCatchAll('example.com', false);

  const r = await p.check('cmo@example.com', [
    'nsmtp.example.com',
    'aspmx.l.google.com',
    'alt1.aspmx.l.google.com',
  ]);

  assert.equal(r.reachable, true);
  assert.equal(r.mailboxExists, true);
  assert.equal(r.mxHost, 'aspmx.l.google.com');
  assert.deepEqual(calls, ['nsmtp.example.com', 'aspmx.l.google.com']);
  assert.deepEqual(r.triedHosts, ['nsmtp.example.com', 'aspmx.l.google.com']);
});

test('MX fallback: connected primary greylist does NOT hop to secondary', async () => {
  const calls = [];
  const p = probe(async (host, _from, recipients) => {
    calls.push(host);
    const email = recipients[0];
    return { connected: true, greeting: 220, rcpt: { [email]: 450 }, error: null };
  });
  p._setCatchAll('example.com', false);

  const r = await p.check('user@example.com', ['mx1.example.com', 'mx2.example.com']);
  assert.equal(r.reachable, true);
  assert.equal(r.temporaryFailure, true);
  assert.equal(r.mxHost, 'mx1.example.com');
  assert.deepEqual(calls, ['mx1.example.com']);
});

test('MX fallback: all hosts unreachable -> inconclusive + mxUnreachable', async () => {
  const p = probe(async () => ({ connected: false, rcpt: {}, error: 'ETIMEDOUT' }));
  const hosts = ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com'];
  const r = await p.check('user@example.com', hosts);
  assert.equal(r.reachable, false);
  assert.equal(r.inconclusive, true);
  assert.equal(r.mxUnreachable, true);
  assert.equal(r.triedHosts.length, MAX_MX_ATTEMPTS);
  assert.deepEqual(r.triedHosts, hosts.slice(0, MAX_MX_ATTEMPTS));
});
