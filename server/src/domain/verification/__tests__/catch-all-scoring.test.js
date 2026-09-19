// Catch-all / scoring / campaign eligibility requirements:
//  1. Catch-all → ACCEPTED
//  2. Catch-all → no health-score penalty
//  3. Catch-all → campaign eligible
//  4. Unknown → no false-negative penalty
//  5. Definitive 550 → negative score
//  6. Invalid/disposable → negative score
//  7. Existing Safe (proven deliverable) continues working
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VerificationEngine,
  DELIVERABILITY,
  ACTION,
  ACCEPTANCE_TYPE,
  MAILBOX_STATUS,
} from '../engine.js';
import { summarize } from '../health.js';
import { CampaignPreflight } from '../../../application/campaign-use-cases.js';

function refData(over = {}) {
  return {
    isReservedDomain: over.reserved || (() => false),
    typoSuggestion: over.typo || (() => null),
    isDisposable: over.disposable || (() => false),
    isRole: over.role || (() => false),
  };
}

const healthyDns = {
  resolveDomain: async () => ({
    domainExists: true, hasMx: true, mxHosts: ['mx.example.com'], aRecord: false,
  }),
};
const nullProvider = { verify: async () => ({ deliverable: null, catchAll: false, provider: 'none' }) };

function engineWith({ smtp, ref = refData(), dns = healthyDns }) {
  return new VerificationEngine({
    dnsResolver: dns,
    smtpProbe: smtp,
    getProvider: () => nullProvider,
    referenceData: ref,
  });
}

test('1) Catch-all → status ACCEPTED + type CATCH_ALL + KEEP (not REVIEW)', async () => {
  const smtp = { check: async () => ({ reachable: true, catchAll: true, source: 'smtp-worker' }) };
  const r = await engineWith({ smtp }).verify('director@iima.ac.in');
  assert.equal(r.deliverability, DELIVERABILITY.ACCEPTED);
  assert.equal(r.status, 'accepted');
  assert.equal(r.acceptanceType, ACCEPTANCE_TYPE.CATCH_ALL);
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.ACCEPT_ALL);
  // Canonical semantics: catch-all mailbox is NOT independently confirmed, so
  // it is REVIEW (human decision), not an automatic KEEP/Safe.
  assert.equal(r.recommendedAction, ACTION.REVIEW);
  assert.equal(r.classification, 'review');
  assert.notEqual(r.classification, 'safe');
});

test('2) Catch-all → small uncertainty penalty, far less than undeliverable', async () => {
  const safe = {
    email: 'a@x.com', classification: 'safe', status: 'deliverable', score: 100,
    riskSignals: [],
  };
  const catchAll = {
    email: 'b@y.com', classification: 'review', status: 'accepted', score: 100,
    riskSignals: [{ code: 'catch_all', label: 'Catch-all · accepted' }],
    acceptanceType: 'CATCH_ALL', mailboxStatus: 'ACCEPT_ALL',
  };
  const undeliverable = {
    email: 'c@z.com', classification: 'remove', status: 'undeliverable', score: 5,
    riskSignals: [],
  };
  const onlySafe = summarize([safe, safe, safe]);
  const withCatchAll = summarize([safe, safe, catchAll]);
  const withUndeliverable = summarize([safe, safe, undeliverable]);

  // Catch-all IS a mild uncertainty cost now (mailbox unconfirmed), but it must
  // be far smaller than a definitive undeliverable and must not gut the score.
  assert.ok(withCatchAll.health < onlySafe.health,
    'catch-all applies a small uncertainty penalty');
  assert.ok(withCatchAll.health > withUndeliverable.health,
    'catch-all penalty must be much lighter than undeliverable');
  // 1/3 catch-all × 0.25 weight ≈ 8.3 penalty → health ≈ 91.7, still healthy.
  assert.ok(withCatchAll.health >= 88 && withCatchAll.health <= 93,
    `catch-all health should stay high, got ${withCatchAll.health}`);
  assert.equal(withCatchAll.breakdown.catchAll, 1);
});

test('3) Catch-all → campaign eligible in preflight', () => {
  const contacts = [
    { email: 'a@x.com', classification: 'safe', status: 'deliverable', signals: [], riskSignals: [] },
    {
      email: 'b@y.com', classification: 'safe', status: 'accepted', acceptanceType: 'CATCH_ALL',
      signals: [{ status: 'info', label: 'Catch-all domain (mail path healthy)' }],
      riskSignals: [{ code: 'catch_all' }],
    },
    { email: 'c@z.com', classification: 'remove', status: 'undeliverable', signals: [], riskSignals: [] },
  ];
  const uc = new CampaignPreflight({
    lists: { findByIdForUser: () => ({ id: 'l1', name: 't' }) },
    contacts: { findByList: () => contacts },
  });
  const r = uc.execute('u1', 'l1');
  assert.equal(r.buckets.catchAll, 1, 'catch-all surfaced explicitly');
  assert.equal(r.buckets.confirmed, 1, 'only the deliverable is confirmed');
  // Canonical semantics: catch-all is NOT confirmed, so the default recommended
  // send list is CONFIRMED only (1), NOT confirmed + catch-all (2).
  assert.equal(r.recommendedSendList, 1, 'catch-all is REVIEW, not auto-eligible');
  assert.equal(r.eligibility.confirmed, 1);
  assert.equal(r.eligibility.review, 1);
  assert.equal(r.eligibility.blocked, 1);
  assert.match(r.verdict, /caution|confirmed/i);
});

test('4) Unknown → no false-negative / major penalty score', async () => {
  const smtp = {
    check: async () => ({
      reachable: false, inconclusive: true, mxUnreachable: true,
      error: 'timeout', triedHosts: ['mx.example.com'], source: 'local-smtp',
    }),
  };
  const r = await engineWith({ smtp }).verify('u@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNKNOWN);
  assert.notEqual(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.ok(r.score >= 70, `unknown with healthy MX should score neutrally, got ${r.score}`);
  assert.equal(r.recommendedAction, ACTION.REVERIFY);
});

test('5) Definitive 550 → negative score + REMOVE', async () => {
  const smtp = {
    check: async () => ({
      reachable: true, mailboxRejected: true, code: 550, source: 'smtp-worker',
    }),
  };
  const r = await engineWith({ smtp }).verify('ghost@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.REMOVE);
  assert.ok(r.score <= 10);
});

test('6) Disposable → negative score + REMOVE', async () => {
  const smtp = { check: async () => ({ skipped: true }) };
  const r = await engineWith({
    smtp,
    ref: refData({ disposable: () => true }),
  }).verify('x@mailinator.com');
  assert.equal(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.REMOVE);
  assert.ok(r.score <= 15);
});

test('7) Proven Safe / deliverable continues to work', async () => {
  const smtp = {
    check: async () => ({
      reachable: true, mailboxExists: true, catchAll: false, source: 'smtp-worker',
    }),
  };
  const r = await engineWith({ smtp }).verify('real@example.com');
  assert.equal(r.deliverability, DELIVERABILITY.DELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.KEEP);
  assert.equal(r.classification, 'safe');
  assert.equal(r.score, 100);
  assert.equal(r.acceptanceType, null);
});
