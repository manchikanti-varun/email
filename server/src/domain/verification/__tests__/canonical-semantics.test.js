// REGRESSION: canonical verdict semantics — the 291-contact case that exposed
// the internal inconsistency (Safe=174 while only 98 were deliverable, and a
// "Deliverability 99%" metric). Every layer must now agree on ONE model:
//   DELIVERABLE  → safe / CONFIRMED / campaign-eligible
//   ACCEPT_ALL   → review / REVIEW  / NOT auto-eligible (mailbox unconfirmed)
//   UNKNOWN      → unknown / UNCONFIRMED / NOT eligible
//   UNDELIVERABLE→ remove / BLOCKED
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveVerdict, tallyVerdicts, semanticsFor, isCampaignEligible,
  VERDICT, CLEANING_BUCKET, CAMPAIGN_ELIGIBILITY,
} from '../verdict-semantics.js';
import { summarize } from '../health.js';
import { buildListHealth } from '../../../../agent/intelligence/list-health.js';
import { CampaignPreflight } from '../../../application/campaign-use-cases.js';
import { GetExportData, GetCleaningPlan } from '../../../application/list-use-cases.js';

// ---- Fixture: the actual 291-contact distribution --------------------------
// 98 deliverable, 2 undeliverable, 115 unknown, 76 accept-all (catch-all).
function makeFixture() {
  const rows = [];
  for (let i = 0; i < 98; i++) rows.push(deliverable(`d${i}@iith.ac.in`));
  for (let i = 0; i < 2; i++) rows.push(undeliverable(`x${i}@iiml.ac.in`));
  for (let i = 0; i < 115; i++) rows.push(unknown(`u${i}@iitg.ac.in`));
  for (let i = 0; i < 76; i++) rows.push(catchAll(`a${i}@iitr.ac.in`));
  return rows;
}
function deliverable(email) {
  return { email, deliverability: 'deliverable', status: 'deliverable', classification: 'safe', score: 100, riskSignals: [], signals: [] };
}
function undeliverable(email) {
  return { email, deliverability: 'undeliverable', status: 'undeliverable', classification: 'remove', score: 5, riskSignals: [], signals: [] };
}
function unknown(email) {
  return { email, deliverability: 'unknown', status: 'unknown', classification: 'unknown', score: 80, finalReason: 'all_mx_unreachable', smtpSource: 'none', riskSignals: [], signals: [] };
}
function catchAll(email) {
  return {
    email, deliverability: 'accepted', status: 'accepted', classification: 'review', score: 100,
    acceptanceType: 'CATCH_ALL', mailboxStatus: 'ACCEPT_ALL',
    riskSignals: [{ code: 'catch_all', label: 'Catch-all · accepted' }], signals: [],
  };
}

const TOTAL = 291;

// ---- 1. Verdict resolution --------------------------------------------------
test('resolveVerdict maps each state canonically (catch-all never deliverable)', () => {
  assert.equal(resolveVerdict(deliverable('a@x.com')), VERDICT.DELIVERABLE);
  assert.equal(resolveVerdict(undeliverable('a@x.com')), VERDICT.UNDELIVERABLE);
  assert.equal(resolveVerdict(unknown('a@x.com')), VERDICT.UNKNOWN);
  assert.equal(resolveVerdict(catchAll('a@x.com')), VERDICT.ACCEPT_ALL);
  // A bare status 'accepted' with no other signal is still catch-all, not deliverable.
  assert.equal(resolveVerdict({ deliverability: 'accepted' }), VERDICT.ACCEPT_ALL);
});

test('semantics table: catch-all is review/REVIEW and NOT campaign-eligible', () => {
  const s = semanticsFor(VERDICT.ACCEPT_ALL);
  assert.equal(s.cleaningBucket, CLEANING_BUCKET.REVIEW);
  assert.equal(s.campaignEligibility, CAMPAIGN_ELIGIBILITY.REVIEW);
  assert.equal(s.campaignEligible, false);
  assert.equal(isCampaignEligible(catchAll('a@x.com')), false);
  assert.equal(isCampaignEligible(deliverable('a@x.com')), true);
  assert.equal(isCampaignEligible(unknown('a@x.com')), false);
});

// ---- 2. Tally + metric sums -------------------------------------------------
test('tallyVerdicts produces the exact fixture counts and buckets', () => {
  const t = tallyVerdicts(makeFixture());
  assert.equal(t.total, TOTAL);
  assert.equal(t.verdicts.deliverable, 98);
  assert.equal(t.verdicts.undeliverable, 2);
  assert.equal(t.verdicts.unknown, 115);
  assert.equal(t.verdicts.acceptAll, 76);
  // Cleaning buckets: catch-all → review, unknown → its own bucket.
  assert.equal(t.cleaning.safe, 98);
  assert.equal(t.cleaning.review, 76);
  assert.equal(t.cleaning.unknown, 115);
  assert.equal(t.cleaning.remove, 2);
  // Eligibility.
  assert.equal(t.eligibility.CONFIRMED, 98);
  assert.equal(t.eligibility.REVIEW, 76);
  assert.equal(t.eligibility.UNCONFIRMED, 115);
  assert.equal(t.eligibility.BLOCKED, 2);
  assert.equal(t.confirmedEligible, 98);
});

test('verdict percentages sum to 100% (± rounding)', () => {
  const t = tallyVerdicts(makeFixture());
  const sum = t.percentages.deliverable + t.percentages.undeliverable
    + t.percentages.unknown + t.percentages.acceptAll + t.percentages.risky;
  assert.ok(Math.abs(sum - 100) <= 0.2, `percentages sum ${sum}`);
  // The specific shares the UI must show.
  assert.equal(t.percentages.deliverable, 33.7);
  assert.equal(t.percentages.undeliverable, 0.7);
  assert.equal(t.percentages.unknown, 39.5);
  assert.equal(t.percentages.acceptAll, 26.1);
});

// ---- 3. summarize(): cleaning summary + honest deliverability metric --------
test('summarize(): Safe=98 (NOT 174), and Deliverability metric = 33.7% (NOT 99%)', () => {
  const s = summarize(makeFixture());
  assert.equal(s.total, TOTAL);
  // Cleaning summary counts — catch-all is NOT folded into Safe any more.
  assert.equal(s.counts.safe, 98);
  assert.equal(s.counts.review, 76);
  assert.equal(s.counts.unknown, 115);
  assert.equal(s.counts.remove, 2);
  // The headline "Deliverability" metric is now confirmed mailbox-level only.
  assert.equal(s.metrics.deliverability, 34); // round(98/291*100)
  assert.equal(s.metrics.mailboxDeliverability, 34);
  assert.notEqual(s.metrics.deliverability, 99); // the bug we fixed
  assert.equal(s.metrics.catchAllAcceptance, 26); // round(76/291*100)
  assert.equal(s.metrics.unconfirmed, 40); // round(115/291*100)
});

test('summarize(): health score meaningfully reflects uncertainty', () => {
  const s = summarize(makeFixture());
  // weightedRisk ≈ undeliverable 0.7 + unknown 39.5*0.35 (13.83) + acceptAll 26.1*0.25 (6.53) ≈ 21.1
  // → health ≈ 78.9. Must be well below the old ~91 and clearly not ~100.
  assert.ok(s.health >= 74 && s.health <= 84, `health ${s.health} should reflect uncertainty`);
});

// ---- 4. buildListHealth agrees with summarize -------------------------------
test('buildListHealth score matches summarize health (one model)', () => {
  const s = summarize(makeFixture());
  const r = buildListHealth({ contacts: makeFixture() });
  assert.ok(Math.abs(r.healthScore - s.health) <= 0.2, `diagnosis ${r.healthScore} vs summary ${s.health}`);
  // Distribution uses TRUE deliverable (excludes catch-all).
  assert.equal(r.metrics.deliverable, 98);
  assert.equal(r.metrics.acceptAll, 76);
  assert.equal(r.metrics.percentages.deliverable, 33.7);
});

test('buildListHealth surfaces the verification-infrastructure-limitation signal', () => {
  const r = buildListHealth({ contacts: makeFixture() });
  const infra = r.riskSignals.find((x) => x.code === 'verification_infrastructure_limitation');
  assert.ok(infra, 'infra-limitation signal present when many unknowns are transport-driven');
  assert.equal(infra.count, 115);
});

// ---- 5. Campaign preflight --------------------------------------------------
test('preflight: recommended send list = CONFIRMED (98) only, catch-all NOT auto-eligible', () => {
  const uc = new CampaignPreflight({
    lists: { findByIdForUser: () => ({ id: 'l1', name: 'fixture' }) },
    contacts: { findByList: () => makeFixture() },
  });
  const r = uc.execute('u1', 'l1');
  assert.equal(r.recipients, TOTAL);
  assert.equal(r.buckets.confirmed, 98);
  assert.equal(r.buckets.catchAll, 76);
  assert.equal(r.buckets.unknown, 115);
  assert.equal(r.buckets.blocked, 2);
  assert.equal(r.recommendedSendList, 98, 'confirmed only — NOT 174');
  assert.notEqual(r.recommendedSendList, 174);
  assert.equal(r.eligibility.confirmed, 98);
  assert.equal(r.eligibility.review, 76);
  assert.equal(r.eligibility.unconfirmed, 115);
  assert.equal(r.eligibility.blocked, 2);
});

// ---- 6. Exports -------------------------------------------------------------
test('export "campaign"/"confirmed" contains ONLY the 98 confirmed (no catch-all/unknown)', () => {
  const uc = new GetExportData({
    lists: { findByIdForUser: () => ({ id: 'l1', name: 'f' }) },
    contacts: { findByList: () => makeFixture() },
  });
  assert.equal(uc.execute('u', 'l1', 'campaign').contacts.length, 98);
  assert.equal(uc.execute('u', 'l1', 'confirmed').contacts.length, 98);
  // Explicit catch-all export is separate and opt-in.
  assert.equal(uc.execute('u', 'l1', 'catchall').contacts.length, 76);
  // Explicit broader policy = confirmed + catch-all.
  assert.equal(uc.execute('u', 'l1', 'sendlist-extended').contacts.length, 98 + 76);
  // Everything.
  assert.equal(uc.execute('u', 'l1', 'all').contacts.length, TOTAL);
});

test('cleaning plan: campaignReady = confirmed (98), catch-all→review, unknown→reverify', () => {
  const uc = new GetCleaningPlan({
    lists: { findByIdForUser: () => ({ id: 'l1', name: 'f' }) },
    contacts: { findByList: () => makeFixture() },
  });
  const r = uc.execute('u', 'l1');
  assert.equal(r.keep, 98);
  assert.equal(r.campaignReady, 98);
  assert.equal(r.review, 76);
  assert.equal(r.reverify, 115);
  assert.equal(r.remove, 2);
});

// ---- 7. Health-score boundaries --------------------------------------------
test('health boundaries: all-deliverable=100, all-undeliverable=0, all-unknown penalised', () => {
  const allDeliv = summarize(Array.from({ length: 50 }, (_, i) => deliverable(`d${i}@x.com`)));
  const allDead = summarize(Array.from({ length: 50 }, (_, i) => undeliverable(`x${i}@x.com`)));
  const allUnknown = summarize(Array.from({ length: 50 }, (_, i) => unknown(`u${i}@x.com`)));
  const allCatch = summarize(Array.from({ length: 50 }, (_, i) => catchAll(`a${i}@x.com`)));
  assert.equal(allDeliv.health, 100);
  assert.equal(allDead.health, 0);
  // Unknown: 100% * 0.35 = 35 → 65. Catch-all: 100% * 0.25 = 25 → 75.
  assert.equal(allUnknown.health, 65);
  assert.equal(allCatch.health, 75);
  // Ordering: deliverable > catch-all > unknown > undeliverable.
  assert.ok(allDeliv.health > allCatch.health);
  assert.ok(allCatch.health > allUnknown.health);
  assert.ok(allUnknown.health > allDead.health);
});
