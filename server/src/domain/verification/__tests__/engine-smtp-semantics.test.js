// Verifies the CORE PRODUCT PRINCIPLE end-to-end through the real engine:
// "Never turn lack of evidence into negative evidence."
// SMTP infra failure -> unknown (not undeliverable); role-based stays keep;
// catch-all -> risky/review; a real 550 -> undeliverable. Uses injected fakes
// so no network is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerificationEngine, DELIVERABILITY, ACTION } from '../engine.js';

// Minimal reference-data fake: healthy defaults, with per-test overrides.
function refData(over = {}) {
  return {
    isReservedDomain: over.reserved || (() => false),
    typoSuggestion: over.typo || (() => null),
    isDisposable: over.disposable || (() => false),
    isRole: over.role || (() => false),
  };
}

const healthyDns = { resolveDomain: async () => ({ domainExists: true, hasMx: true, mxHosts: ['mx.example.com'], aRecord: false }) };
const nullProvider = { verify: async () => ({ deliverable: null, catchAll: false, provider: 'none' }) };

function engineWith({ smtp, ref = refData(), dns = healthyDns, provider = nullProvider }) {
  return new VerificationEngine({ dnsResolver: dns, smtpProbe: smtp, getProvider: () => provider, referenceData: ref });
}

test('SMTP infrastructure failure (skipped) -> UNKNOWN, action reverify, NOT undeliverable/remove', async () => {
  const smtp = { check: async () => ({ skipped: true, reachable: null, source: 'none' }) };
  const r = await engineWith({ smtp }).verify('john@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNKNOWN);
  assert.notEqual(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.notEqual(r.recommendedAction, ACTION.REMOVE);
  assert.equal(r.recommendedAction, ACTION.REVERIFY);
});

test('worker timeout (inconclusive) -> UNKNOWN, never a negative verdict', async () => {
  const smtp = { check: async () => ({ reachable: false, error: 'worker-timeout', inconclusive: true, source: 'smtp-worker' }) };
  const r = await engineWith({ smtp }).verify('john@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNKNOWN);
  assert.ok(r.deliverabilityScore > 5, 'score must not collapse to the undeliverable floor');
});

test('MX unreachable (tried hosts) -> UNKNOWN with handshake evidence, not port-25 blame', async () => {
  const smtp = {
    check: async () => ({
      reachable: false,
      error: 'timeout',
      inconclusive: true,
      mxUnreachable: true,
      triedHosts: ['nsmtp.example.com', 'aspmx.l.google.com'],
      source: 'local-smtp',
    }),
  };
  const r = await engineWith({ smtp }).verify('cmo@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNKNOWN);
  assert.equal(r.recommendedAction, ACTION.REVERIFY);
  assert.ok(
    r.evidence.some((e) => /handshake/i.test(e.label)),
    'should report MX handshake failure',
  );
  assert.ok(
    !r.evidence.some((e) => /port 25 unavailable/i.test(e.label)),
    'must not blame outbound port 25 when MX hosts were tried',
  );
  assert.ok(r.reasons.some((t) => /mail servers completed an SMTP handshake/i.test(t)));
});

test('worker confirms mailbox (accepted) -> DELIVERABLE, source recorded', async () => {
  const smtp = { check: async () => ({ reachable: true, mailboxExists: true, source: 'smtp-worker' }) };
  const r = await engineWith({ smtp }).verify('john@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.DELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.KEEP);
  assert.equal(r.smtpSource, 'smtp-worker');
});

test('worker reports 550 (rejected) -> UNDELIVERABLE, remove', async () => {
  const smtp = { check: async () => ({ reachable: true, mailboxRejected: true, source: 'smtp-worker' }) };
  const r = await engineWith({ smtp }).verify('ghost@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.REMOVE);
});

test('catch-all -> ACCEPTED + KEEP (campaign-eligible), NOT removed', async () => {
  const smtp = { check: async () => ({ reachable: true, catchAll: true, source: 'smtp-worker' }) };
  const r = await engineWith({ smtp }).verify('anyone@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.ACCEPTED);
  assert.equal(r.mailboxStatus, 'ACCEPT_ALL');
  assert.equal(r.recommendedAction, ACTION.KEEP);
  assert.equal(r.classification, 'safe');
  assert.equal(r.score, 100);
  assert.ok(r.reasons.some((t) => /catch-all|Accepted/i.test(t)));
});

test('role-based address that is deliverable -> KEEP, role is a characteristic not a penalty', async () => {
  const smtp = { check: async () => ({ reachable: true, mailboxExists: true, source: 'smtp-worker' }) };
  const ref = refData({ role: (local) => local === 'sales' });
  const r = await engineWith({ smtp, ref }).verify('sales@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.DELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.KEEP);
  assert.ok(r.riskSignals.some((s) => s.code === 'role_based'), 'role is surfaced as a signal');
});

test('greylisting (temporary) -> not undeliverable', async () => {
  const smtp = { check: async () => ({ reachable: true, temporaryFailure: true, greylisted: true, source: 'smtp-worker' }) };
  const r = await engineWith({ smtp }).verify('grey@example.com');
  assert.notEqual(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.notEqual(r.recommendedAction, ACTION.REMOVE);
});
