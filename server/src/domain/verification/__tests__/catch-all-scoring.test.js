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
  assert.equal(r.recommendedAction, ACTION.KEEP);
  assert.equal(r.classification, 'safe');
  assert.notEqual(r.recommendedAction, ACTION.REVIEW);
});

test('2) Catch-all → no health-score penalty vs proven safe list', async () => {
  const safe = {
    email: 'a@x.com', classification: 'safe', status: 'deliverable', score: 100,
    riskSignals: [],
  };
  const catchAll = {
    email: 'b@y.com', classification: 'safe', status: 'accepted', score: 100,
    riskSignals: [{ code: 'catch_all', label: 'Catch-all · accepted' }],
    acceptanceType: 'CATCH_ALL', mailboxStatus: 'ACCEPT_ALL',
  };
  const onlySafe = summarize([safe, safe, safe]);
  const withCatchAll = summarize([safe, safe, catchAll]);
  assert.ok(withCatchAll.health >= onlySafe.health - 0.5,
    `catch-all must not reduce health (safe=${onlySafe.health}, mixed=${withCatchAll.health})`);
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
  assert.equal(r.buckets.catchAll, 1);
  assert.equal(r.buckets.safe, 1);
  assert.equal(r.recommendedSendList, 2, 'safe + catch-all are campaign-eligible');
  assert.match(r.verdict, /Good to send|caution|eligible|Accepted/i);
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
