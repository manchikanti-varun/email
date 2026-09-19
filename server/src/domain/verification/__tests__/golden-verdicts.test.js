// PHASE 2B.5 / 2B.6 / 2B.7 / 2B.10 — Golden verdict, multi-vantage, catch-all,
// and port-25 failure regression tests, driven through the REAL engine with
// injected fakes (no network). These pin the documented invariants:
//   definitive negative -> UNDELIVERABLE
//   definitive positive -> DELIVERABLE
//   real+random accept  -> ACCEPT_ALL
//   lack of evidence    -> UNKNOWN
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VerificationEngine, DELIVERABILITY, ACTION, MAILBOX_STATUS,
} from '../engine.js';
import { aggregateVantageEvidence } from '../smtp-classify.js';

const healthyDns = {
  resolveDomain: async () => ({ domainExists: true, hasMx: true, mxHosts: ['mx1.example.com', 'mx2.example.com'], aRecord: false }),
};
const nullProvider = { verify: async () => ({ deliverable: null, catchAll: false, provider: 'none' }) };
const refData = {
  isReservedDomain: () => false, typoSuggestion: () => null,
  isDisposable: () => false, isRole: () => false,
};

function engineWith(smtpResult) {
  const smtp = { check: async () => smtpResult };
  return new VerificationEngine({ dnsResolver: healthyDns, smtpProbe: smtp, getProvider: () => nullProvider, referenceData: refData });
}

// ---- 2B.5 Golden verdicts --------------------------------------------------
test('Golden 1 — mailbox confirmed, not catch-all -> DELIVERABLE / KEEP', async () => {
  const r = await engineWith({ reachable: true, mailboxExists: true, catchAll: false, source: 'smtp-worker' }).verify('a@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.DELIVERABLE);
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.DELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.KEEP);
});

test('Golden 2 — mailbox rejected -> UNDELIVERABLE / REMOVE', async () => {
  const r = await engineWith({ reachable: true, mailboxRejected: true, source: 'smtp-worker' }).verify('a@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.REMOVE);
});

test('Golden 3 — real+random accept (catchAll) -> ACCEPT_ALL / KEEP, NOT DELIVERABLE', async () => {
  const r = await engineWith({ reachable: true, catchAll: true, source: 'smtp-worker' }).verify('a@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.ACCEPT_ALL);
  // Canonical semantics: catch-all is UNCONFIRMED (mailbox not proven) → REVIEW,
  // never an automatic KEEP/Safe. It is still NOT DELIVERABLE.
  assert.equal(r.recommendedAction, ACTION.REVIEW);
  assert.equal(r.classification, 'review');
  assert.notEqual(r.mailboxStatus, MAILBOX_STATUS.DELIVERABLE);
  assert.notEqual(r.deliverability, DELIVERABILITY.DELIVERABLE);
});

test('Golden 4 — temporary/greylist -> UNKNOWN / REVERIFY, NOT UNDELIVERABLE', async () => {
  const r = await engineWith({ reachable: true, temporaryFailure: true, greylisted: true, source: 'smtp-worker' }).verify('a@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
  assert.equal(r.recommendedAction, ACTION.REVERIFY);
  assert.notEqual(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
});

test('Golden 5 — timeout -> UNKNOWN, NOT UNDELIVERABLE', async () => {
  const r = await engineWith({ reachable: false, error: 'timeout', inconclusive: true, mxUnreachable: true, triedHosts: ['mx1.example.com'], source: 'local-smtp' }).verify('a@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
  assert.notEqual(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
});

test('Golden 6 — connection refused -> UNKNOWN', async () => {
  const r = await engineWith({ reachable: false, error: 'ECONNREFUSED', smtpClass: 'connection_refused', inconclusive: true, source: 'local-smtp' }).verify('a@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
});

test('Golden 7 — TLS failure -> UNKNOWN', async () => {
  const r = await engineWith({ reachable: false, error: 'EPROTO', smtpClass: 'tls_failure', inconclusive: true, source: 'local-smtp' }).verify('a@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
});

test('Golden 8 — worker unavailable -> UNKNOWN', async () => {
  const r = await engineWith({ skipped: true, reachable: null, source: 'none' }).verify('a@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
  assert.notEqual(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
});

// ---- 2B.6 Multi-vantage aggregation (aggregateVantageEvidence) ------------
// vantage results are probe-shaped; tag them with `vantage`.
const V = {
  timeout: (v) => ({ vantage: v, reachable: false, inconclusive: true, error: 'timeout', triedHosts: ['mx'], mxUnreachable: true }),
  accept: (v) => ({ vantage: v, reachable: true, mailboxExists: true, catchAll: false }),
  reject: (v) => ({ vantage: v, reachable: true, mailboxRejected: true, code: 550 }),
  temporary: (v) => ({ vantage: v, reachable: true, temporaryFailure: true }),
  catchAll: (v) => ({ vantage: v, reachable: true, catchAll: true }),
};

test('Case A — local timeout + remote 550 -> UNDELIVERABLE (rejection wins)', () => {
  const agg = aggregateVantageEvidence([V.timeout('railway-local'), V.reject('vps-worker')]);
  assert.equal(agg.mailboxRejected, true);
  assert.equal(agg.smtpEvidence.finalReason, 'definitive_recipient_rejection');
});

test('Case B — local 250 + remote timeout -> DELIVERABLE', () => {
  const agg = aggregateVantageEvidence([V.accept('railway-local'), V.timeout('vps-worker')]);
  assert.equal(agg.mailboxExists, true);
  assert.equal(agg.catchAll, false);
  assert.equal(agg.smtpEvidence.finalReason, 'mailbox_accepted');
});

test('Case C — local 250 + remote catch-all -> ACCEPT_ALL (catch-all wins over plain accept)', () => {
  const agg = aggregateVantageEvidence([V.accept('railway-local'), V.catchAll('vps-worker')]);
  assert.equal(agg.catchAll, true);
  assert.equal(agg.smtpEvidence.finalReason, 'catch_all_domain');
});

test('Case D — local timeout + remote timeout -> UNKNOWN (no conclusive evidence)', () => {
  const agg = aggregateVantageEvidence([V.timeout('railway-local'), V.timeout('vps-worker')]);
  assert.notEqual(agg.mailboxExists, true);
  assert.notEqual(agg.mailboxRejected, true);
  assert.notEqual(agg.catchAll, true);
});

test('Case E — local 4xx + remote timeout -> UNKNOWN (temporary, reverify)', () => {
  const agg = aggregateVantageEvidence([V.temporary('railway-local'), V.timeout('vps-worker')]);
  assert.equal(agg.temporaryFailure, true);
  assert.notEqual(agg.mailboxRejected, true);
  assert.equal(agg.smtpEvidence.finalReason, 'temporary_failure');
});

test('Case F — local 550 + remote 250 -> UNDELIVERABLE (documented precedence: rejection wins)', () => {
  const agg = aggregateVantageEvidence([V.reject('railway-local'), V.accept('vps-worker')]);
  // Documented rule: ANY definitive 5xx rejection wins over acceptance.
  assert.equal(agg.mailboxRejected, true);
  assert.equal(agg.smtpEvidence.finalReason, 'definitive_recipient_rejection');
});

// ---- 2B.7 Catch-all through the engine ------------------------------------
test('Catch-all: real 250 + random 250 -> ACCEPT_ALL', async () => {
  const r = await engineWith({ reachable: true, catchAll: true, source: 'smtp-worker' }).verify('x@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.ACCEPT_ALL);
});

test('Catch-all: real 250 + random 550 -> DELIVERABLE', async () => {
  const r = await engineWith({ reachable: true, mailboxExists: true, catchAll: false, source: 'smtp-worker' }).verify('x@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.DELIVERABLE);
});

test('Catch-all: real 550 + random 250 -> UNDELIVERABLE', async () => {
  const r = await engineWith({ reachable: true, mailboxRejected: true, catchAll: false, source: 'smtp-worker' }).verify('x@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
});

test('Catch-all: real 4xx + random 250 -> UNKNOWN (no false catch-all positive)', async () => {
  // Not catch-all (real is temporary, not accepted). Probe layer would not set catchAll.
  const r = await engineWith({ reachable: true, temporaryFailure: true, catchAll: false, source: 'smtp-worker' }).verify('x@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
  assert.notEqual(r.mailboxStatus, MAILBOX_STATUS.ACCEPT_ALL);
});

// ---- 2B.10 Port-25 failure simulation (all -> UNKNOWN via engine) ---------
const PORT25_FAILURES = [
  { name: 'timeout', smtp: { reachable: false, error: 'timeout', smtpClass: 'timeout', inconclusive: true, source: 'local-smtp' } },
  { name: 'ECONNREFUSED', smtp: { reachable: false, error: 'ECONNREFUSED', smtpClass: 'connection_refused', inconclusive: true, source: 'local-smtp' } },
  { name: 'EHOSTUNREACH', smtp: { reachable: false, error: 'EHOSTUNREACH', smtpClass: 'unknown', inconclusive: true, source: 'local-smtp' } },
  { name: 'ENETUNREACH', smtp: { reachable: false, error: 'ENETUNREACH', smtpClass: 'unknown', inconclusive: true, source: 'local-smtp' } },
  { name: 'TLS failure', smtp: { reachable: false, error: 'EPROTO', smtpClass: 'tls_failure', inconclusive: true, source: 'local-smtp' } },
  { name: 'worker HTTP timeout', smtp: { reachable: false, error: 'worker-timeout', smtpClass: 'timeout', inconclusive: true, source: 'smtp-worker' } },
  { name: 'worker HTTP 500', smtp: { reachable: false, error: 'worker_http_500', inconclusive: true, source: 'none' } },
  { name: 'worker unavailable', smtp: { skipped: true, reachable: null, source: 'none' } },
];

for (const c of PORT25_FAILURES) {
  test(`Port-25 failure "${c.name}" -> UNKNOWN, never UNDELIVERABLE`, async () => {
    const r = await engineWith(c.smtp).verify('a@example.com');
    assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN, `${c.name} must be UNKNOWN`);
    assert.notEqual(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
    assert.notEqual(r.recommendedAction, ACTION.REMOVE);
  });
}
