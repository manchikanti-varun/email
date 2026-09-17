import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smtpConversation, classifyCode, isTransportFailure } from '../smtp-probe.js';
import {
  isCatchAll, getCachedCatchAll, setCachedCatchAll, clearCatchAllCache,
} from '../catch-all.js';
import { startFakeMx } from './fake-mx.js';

const opts = (port, recipients) => ({ from: 'v@test', ehlo: 'test', recipients, timeoutMs: 2000, port });

test('classifyCode maps SMTP code ranges', () => {
  assert.equal(classifyCode(250), 'accepted');
  assert.equal(classifyCode(450), 'temporary');
  assert.equal(classifyCode(550), 'rejected');
  assert.equal(classifyCode(undefined), 'no_response');
});

test('accepted recipient (250) -> accepted', async () => {
  const mx = await startFakeMx({ rcptReply: () => 250 });
  const r = await smtpConversation(mx.host, opts(mx.port, ['user@example.com']));
  await mx.close();
  assert.equal(r.connected, true);
  assert.equal(classifyCode(r.rcpt['user@example.com'].code), 'accepted');
});

test('rejected recipient (550) -> rejected', async () => {
  const mx = await startFakeMx({ rcptReply: () => 550 });
  const r = await smtpConversation(mx.host, opts(mx.port, ['ghost@example.com']));
  await mx.close();
  assert.equal(classifyCode(r.rcpt['ghost@example.com'].code), 'rejected');
});

test('temporary (450) -> temporary', async () => {
  const mx = await startFakeMx({ rcptReply: () => 450 });
  const r = await smtpConversation(mx.host, opts(mx.port, ['grey@example.com']));
  await mx.close();
  assert.equal(classifyCode(r.rcpt['grey@example.com'].code), 'temporary');
});

test('timeout -> transport failure, NOT a mailbox verdict', async () => {
  const mx = await startFakeMx({ mode: 'timeout' });
  const r = await smtpConversation(mx.host, { ...opts(mx.port, ['x@example.com']), timeoutMs: 400 });
  await mx.close();
  assert.equal(r.connected, false);
  assert.ok(isTransportFailure(r.error));
  assert.equal(r.rcpt['x@example.com'], undefined); // no mailbox evidence
});

test('catch-all: real + random both accepted -> catchAll', async () => {
  // Accept everything.
  const mx = await startFakeMx({ rcptReply: () => 250 });
  const r = await smtpConversation(mx.host, opts(mx.port, ['real@example.com', 'random-xyz@example.com']));
  await mx.close();
  const targetStatus = classifyCode(r.rcpt['real@example.com'].code);
  const probeStatus = classifyCode(r.rcpt['random-xyz@example.com'].code);
  assert.equal(isCatchAll({ targetStatus, probeStatus }), true);
});

test('non-catch-all: real accepted, random rejected -> not catchAll', async () => {
  const mx = await startFakeMx({ rcptReply: (r) => (r.startsWith('real@') ? 250 : 550) });
  const r = await smtpConversation(mx.host, opts(mx.port, ['real@example.com', 'random-xyz@example.com']));
  await mx.close();
  const targetStatus = classifyCode(r.rcpt['real@example.com'].code);
  const probeStatus = classifyCode(r.rcpt['random-xyz@example.com'].code);
  assert.equal(isCatchAll({ targetStatus, probeStatus }), false);
});

test('not catch-all when only random accepts (real rejected)', () => {
  assert.equal(isCatchAll({ targetStatus: 'rejected', probeStatus: 'accepted' }), false);
});

test('classifyCode distinguishes rate_limited via response text', () => {
  assert.equal(classifyCode(421, '4.7.0 Rate limited — try again later'), 'rate_limited');
  assert.equal(classifyCode(550, '5.1.1 User unknown'), 'rejected');
});

test('catch-all domain cache: hit returns stored flag; clear resets', () => {
  clearCatchAllCache();
  assert.equal(getCachedCatchAll('example.com'), null);
  setCachedCatchAll('example.com', false);
  assert.equal(getCachedCatchAll('example.com'), false);
  setCachedCatchAll('catch.com', true);
  assert.equal(getCachedCatchAll('CATCH.com'), true); // domain key is lowercased
  clearCatchAllCache();
  assert.equal(getCachedCatchAll('example.com'), null);
});
