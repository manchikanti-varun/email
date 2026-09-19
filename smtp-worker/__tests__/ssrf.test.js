// PHASE 3B — Worker MX SSRF defence-in-depth (unit).
// The worker must never open a socket to an MX host that resolves to a private,
// loopback, link-local, or metadata address. Uses an injectable resolver so no
// real DNS is required. This is ADDITIVE — it never relaxes any existing check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateIp, isUnsafeHostname, assertSafeMxHost, filterSafeMxHosts,
} from '../ssrf.js';

// ---- IP classification -----------------------------------------------------
test('isPrivateIp: private / loopback / link-local / metadata are unsafe', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '169.254.0.1', '0.0.0.0', '100.64.0.1', '224.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be unsafe`);
  }
});

test('isPrivateIp: public IPv4 is safe', () => {
  for (const ip of ['142.250.72.14', '1.1.1.1', '8.8.8.8', '208.80.154.224']) {
    assert.equal(isPrivateIp(ip), false, `${ip} must be safe`);
  }
});

test('isPrivateIp: IPv6 loopback/link-local/ULA unsafe; public v6 safe', () => {
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('fd00::1'), true);
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback');
  assert.equal(isPrivateIp('::ffff:10.0.0.1'), true, 'IPv4-mapped private');
  assert.equal(isPrivateIp('2607:f8b0:4004:c07::1a'), false, 'public v6 safe');
});

test('isPrivateIp: malformed input is treated as unsafe (fail closed)', () => {
  assert.equal(isPrivateIp('not-an-ip'), true);
  assert.equal(isPrivateIp(''), true);
  assert.equal(isPrivateIp(null), true);
});

// ---- Hostname literal checks ----------------------------------------------
test('isUnsafeHostname: localhost / .local / .internal / private IP literals', () => {
  for (const h of ['localhost', 'foo.localhost', 'mail.local', 'svc.internal',
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '[::1]']) {
    assert.equal(isUnsafeHostname(h), true, `${h} must be unsafe`);
  }
  assert.equal(isUnsafeHostname(''), true);
});

test('isUnsafeHostname: a normal public hostname is not rejected on name alone', () => {
  assert.equal(isUnsafeHostname('gmail-smtp-in.l.google.com'), false);
  assert.equal(isUnsafeHostname('aspmx.l.google.com'), false);
});

// ---- assertSafeMxHost (with injected resolver) ----------------------------
function resolver(map) {
  return { lookupAll: async (host) => { if (!(host in map)) throw new Error('ENOTFOUND'); return map[host]; } };
}

test('assertSafeMxHost: host resolving only to public IPs is safe', async () => {
  const r = await assertSafeMxHost('mx.example.com', { resolver: resolver({ 'mx.example.com': ['142.250.72.14'] }) });
  assert.equal(r.safe, true);
});

test('assertSafeMxHost: host resolving to a private IP is rejected', async () => {
  const r = await assertSafeMxHost('evil.example.com', { resolver: resolver({ 'evil.example.com': ['10.0.0.5'] }) });
  assert.equal(r.safe, false);
  assert.equal(r.reason, 'resolves_to_private_ip');
});

test('assertSafeMxHost: metadata IP is rejected (SSRF)', async () => {
  const r = await assertSafeMxHost('meta.example.com', { resolver: resolver({ 'meta.example.com': ['169.254.169.254'] }) });
  assert.equal(r.safe, false);
});

test('assertSafeMxHost: DNS-rebinding mix (public + private) fails closed', async () => {
  const r = await assertSafeMxHost('rebind.example.com', { resolver: resolver({ 'rebind.example.com': ['142.250.72.14', '127.0.0.1'] }) });
  assert.equal(r.safe, false, 'any private answer makes the host unsafe');
});

test('assertSafeMxHost: DNS failure / no address -> unsafe (fail closed)', async () => {
  const r1 = await assertSafeMxHost('missing.example.com', { resolver: resolver({}) });
  assert.equal(r1.safe, false);
  const r2 = await assertSafeMxHost('empty.example.com', { resolver: resolver({ 'empty.example.com': [] }) });
  assert.equal(r2.safe, false);
});

test('assertSafeMxHost: bare loopback/private literal rejected without DNS', async () => {
  assert.equal((await assertSafeMxHost('127.0.0.1')).safe, false);
  assert.equal((await assertSafeMxHost('10.0.0.1')).safe, false);
  // A public IP literal is safe.
  assert.equal((await assertSafeMxHost('8.8.8.8')).safe, true);
});

test('filterSafeMxHosts: keeps public hosts, drops private, reports reasons', async () => {
  const map = { 'ok.example.com': ['8.8.8.8'], 'bad.example.com': ['192.168.1.1'] };
  const { safe, rejected } = await filterSafeMxHosts(['ok.example.com', 'bad.example.com', 'localhost'], { resolver: resolver(map) });
  assert.deepEqual(safe, ['ok.example.com']);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.some((r) => r.host === 'bad.example.com'));
  assert.ok(rejected.some((r) => r.host === 'localhost'));
});
