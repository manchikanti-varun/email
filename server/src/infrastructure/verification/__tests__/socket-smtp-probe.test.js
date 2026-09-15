// Unit tests for SocketSmtpProbe catch-all domain memoization (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocketSmtpProbe } from '../socket-smtp-probe.js';

function probe() {
  return new SocketSmtpProbe({ enabled: true, from: 'verify@example.com', timeoutMs: 1000 });
}

test('catch-all cache: miss returns null, hit returns stored boolean', () => {
  const p = probe();
  assert.equal(p._catchAllCached('example.com'), null);
  p._setCatchAll('example.com', false);
  assert.equal(p._catchAllCached('example.com'), false);
  p._setCatchAll('catch.com', true);
  assert.equal(p._catchAllCached('catch.com'), true);
});

test('catch-all cache: expired entry is treated as unknown', () => {
  const p = probe();
  p._catchAll.set('old.com', { at: Date.now() - 11 * 60 * 1000, isCatchAll: true });
  assert.equal(p._catchAllCached('old.com'), null);
});
