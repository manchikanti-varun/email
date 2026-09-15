import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GetCampaignRisk, GetHealthAnalysis, GetHealthPrediction, GetListAnomalies,
  GetDomainIntelligence, GetSmartCleaning, GetReverificationPriority,
  GetCreditOptimization, GetEmailExplanation, GetBusinessInsights,
  InvestigateVerification, DetectIncidents, AnalyzeBenchmark,
} from '../ai-use-cases.js';

// ---- Fake existing use-cases (match the real return shapes) ---------------
// A single verified list "L1" owned by user "U1". Any other id/user -> 404,
// exactly like the real repositories via GetListDetail.

const OWNER = 'U1';
const LIST = { id: 'L1', name: 'Customers', total: 5, status: 'done' };

function contactRows() {
  return [
    c('a@good.com', 'deliverable', 'high', 'safe', 'keep', 100),
    c('b@good.com', 'deliverable', 'high', 'safe', 'keep', 100),
    c('sales@corp.com', 'risky', 'medium', 'review', 'review', 55, [{ code: 'catch_all', label: 'Catch-all domain' }]),
    c('x@mailinator.com', 'undeliverable', 'high', 'remove', 'remove', 10, [{ code: 'disposable', label: 'Disposable domain' }], [{ label: 'Disposable / temporary domain', status: 'fail' }]),
    c('y@corp.com', 'unknown', 'low', 'unknown', 'reverify', 50, [], [], null),
  ];
}
function c(email, deliverability, confidence, classification, recommendedAction, score, riskSignals = [], signals = [{ label: 'Valid syntax', status: 'pass' }], verifiedAt = '2026-09-01T00:00:00.000Z') {
  return {
    email, deliverability, status: deliverability, confidence, classification, recommendedAction,
    score, riskSignals, signals, reasons: ['reason'], verified_at: verifiedAt, greylisted: false,
  };
}

function summaryFor(rows) {
  const counts = { safe: 0, review: 0, remove: 0, unknown: 0 };
  for (const r of rows) counts[r.classification]++;
  return {
    health: 62.5,
    counts,
    metrics: { deliverability: 50, dataQuality: 60, risk: 60, domainHealth: 80 },
  };
}

function makeDeps({ history = [], contacts = contactRows(), capability } = {}) {
  const notFound = () => { const e = new Error('List not found'); e.status = 404; throw e; };
  const getListDetail = {
    execute: (userId, listId) => {
      if (userId !== OWNER || listId !== LIST.id) notFound();
      return { list: { ...LIST }, summary: summaryFor(contacts), contacts, history, delta: null };
    },
  };
  const campaignPreflight = {
    execute: (userId, listId) => {
      if (userId !== OWNER || listId !== LIST.id) notFound();
      return { buckets: { safe: 2, review: 1, catchAll: 1, invalid: 1, disposable: 1, unknown: 1 }, recommendedSendList: 2, safePct: 40, verdict: 'Send with caution.' };
    },
  };
  const getCleaningPlan = {
    execute: (userId, listId) => {
      if (userId !== OWNER || listId !== LIST.id) notFound();
      return { keep: 2, review: 2, remove: 1, campaignReady: 2 };
    },
  };
  const getAccountCredits = { execute: (userId) => ({ credits: userId === OWNER ? 100 : 0, plan: 'free' }) };
  const getLists = { execute: (userId) => ({ lists: userId === OWNER ? [{ id: LIST.id, name: LIST.name }] : [] }) };
  return { getListDetail, campaignPreflight, getCleaningPlan, getAccountCredits, getLists, capability };
}

// ---------------------------------------------------------------- campaign
test('GetCampaignRisk orchestrates and returns a risk verdict', () => {
  const deps = makeDeps();
  const uc = new GetCampaignRisk({ getListDetail: deps.getListDetail, campaignPreflight: deps.campaignPreflight });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, true);
  assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(r.riskLevel));
  assert.equal(r.list.id, 'L1');
  assert.match(r.summary, /never guaranteed/i);
});

test('ownership is enforced: wrong user -> 404 propagated', () => {
  const deps = makeDeps();
  const uc = new GetCampaignRisk({ getListDetail: deps.getListDetail, campaignPreflight: deps.campaignPreflight });
  assert.throws(() => uc.execute('someone-else', 'L1'), (e) => e.status === 404);
});

test('missing listId -> 400', () => {
  const deps = makeDeps();
  const uc = new GetHealthAnalysis({ getListDetail: deps.getListDetail });
  assert.throws(() => uc.execute(OWNER, undefined), (e) => e.status === 400);
});

// ---------------------------------------------------------------- health
test('GetHealthAnalysis returns tagged analysis', () => {
  const deps = makeDeps();
  const uc = new GetHealthAnalysis({ getListDetail: deps.getListDetail });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, true);
  assert.ok(r.recommendations.length > 0);
  assert.equal(r.list.name, 'Customers');
});

test('GetHealthPrediction reports insufficient with < 2 snapshots', () => {
  const deps = makeDeps({ history: [{ health: 80, metrics: {}, counts: {}, created_at: '2026-09-01T00:00:00Z' }] });
  const uc = new GetHealthPrediction({ getListDetail: deps.getListDetail });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, false);
  assert.match(r.message, /Insufficient historical data/);
});

test('GetHealthPrediction forecasts with enough snapshots', () => {
  const history = [
    { health: 90, metrics: {}, counts: {}, created_at: '2026-06-01T00:00:00Z' },
    { health: 85, metrics: {}, counts: {}, created_at: '2026-06-08T00:00:00Z' },
    { health: 80, metrics: {}, counts: {}, created_at: '2026-06-15T00:00:00Z' },
  ];
  const uc = new GetHealthPrediction({ getListDetail: makeDeps({ history }).getListDetail });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, true);
  assert.notEqual(r.confidence, 'HIGH');
  assert.ok(r.predictions['90d'] >= 0);
});

// ---------------------------------------------------------------- anomalies
test('GetListAnomalies flags a spike between snapshots', () => {
  const history = [
    { health: 90, counts: { safe: 90, review: 3, remove: 2, unknown: 5 }, metrics: {}, created_at: '2026-06-01T00:00:00Z' },
    { health: 55, counts: { safe: 45, review: 5, remove: 5, unknown: 45 }, metrics: {}, created_at: '2026-06-08T00:00:00Z' },
  ];
  const uc = new GetListAnomalies({ getListDetail: makeDeps({ history }).getListDetail });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.detected, true);
});

// ---------------------------------------------------------------- domains
test('GetDomainIntelligence ranks worst domain first', () => {
  const uc = new GetDomainIntelligence({ getListDetail: makeDeps().getListDetail });
  const r = uc.execute(OWNER, 'L1', { limit: 5 });
  assert.equal(r.available, true);
  assert.ok(r.domains.length >= 1);
  assert.equal(r.domains[0].domain, 'mailinator.com'); // disposable/undeliverable
});

// ---------------------------------------------------------------- cleaning
test('GetSmartCleaning never deletes and returns buckets', () => {
  const deps = makeDeps();
  const uc = new GetSmartCleaning({ getListDetail: deps.getListDetail, getCleaningPlan: deps.getCleaningPlan });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, true);
  assert.match(r.note, /does not delete/i);
  assert.equal(r.buckets.remove, 1);
});

// --------------------------------------------------------- reverify + credits
test('GetReverificationPriority ranks and caps output', () => {
  const uc = new GetReverificationPriority({ getListDetail: makeDeps().getListDetail });
  const r = uc.execute(OWNER, 'L1', { limit: 2 });
  assert.equal(r.available, true);
  assert.ok(r.priority.length <= 2);
});

test('GetCreditOptimization uses account credits', () => {
  const deps = makeDeps();
  const uc = new GetCreditOptimization({ getListDetail: deps.getListDetail, getAccountCredits: deps.getAccountCredits });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, true);
  assert.equal(r.availableCredits, 100);
});

// --------------------------------------------------------------- explanation
test('GetEmailExplanation finds contact by email and 404s otherwise', () => {
  const uc = new GetEmailExplanation({ getListDetail: makeDeps().getListDetail });
  const r = uc.execute(OWNER, 'L1', { email: 'x@mailinator.com', mode: 'technical' });
  assert.equal(r.available, true);
  assert.match(r.explanation, /Disposable|Deliverability=undeliverable/);
  assert.throws(() => uc.execute(OWNER, 'L1', { email: 'nobody@nowhere.com' }), (e) => e.status === 404);
});

// --------------------------------------------------------------- insights
test('GetBusinessInsights avoids unsupported claims', () => {
  const uc = new GetBusinessInsights({ getListDetail: makeDeps().getListDetail });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.available, true);
  assert.match(r.disclaimer, /No claims are made about revenue/);
});

// --------------------------------------------------------------- investigate
test('InvestigateVerification distinguishes infra from deterioration', () => {
  // All-unknown + missing SMTP evidence + no-SMTP capability -> infra.
  const contacts = [
    c('u1@corp.com', 'unknown', 'low', 'unknown', 'reverify', 50, [], [], null),
    c('u2@corp.com', 'unknown', 'low', 'unknown', 'reverify', 50, [], [], null),
    c('u3@corp.com', 'unknown', 'low', 'unknown', 'reverify', 50, [], [], null),
  ];
  const deps = makeDeps({ contacts, capability: { liveSmtp: false, smtpSource: 'none', smtpMode: 'auto', smtpDetail: 'port 25 blocked' } });
  const uc = new InvestigateVerification({ getListDetail: deps.getListDetail, verifyCapability: deps.capability });
  const r = uc.execute(OWNER, 'L1', { question: 'why unknown?' });
  assert.equal(r.available, true);
  assert.ok(r.possibleCauses.some((x) => /infrastructure/i.test(x)));
  assert.match(r.recommendedAction, /SMTP|connectivity|re-verify/i);
});

// --------------------------------------------------------------- incidents
test('DetectIncidents account-wide scans lists', () => {
  const deps = makeDeps({ capability: { liveSmtp: true, smtpSource: 'local-smtp', smtpMode: 'auto' } });
  const uc = new DetectIncidents({ getListDetail: deps.getListDetail, getLists: deps.getLists, verifyCapability: deps.capability });
  const r = uc.execute(OWNER, null);
  assert.equal(r.scope, 'account');
  assert.ok('incidentCount' in r);
});

test('DetectIncidents per-list scopes to one list', () => {
  const deps = makeDeps({ capability: { liveSmtp: true, smtpSource: 'local-smtp', smtpMode: 'auto' } });
  const uc = new DetectIncidents({ getListDetail: deps.getListDetail, getLists: deps.getLists, verifyCapability: deps.capability });
  const r = uc.execute(OWNER, 'L1');
  assert.equal(r.scope, 'list');
  assert.equal(r.list.id, 'L1');
});

// --------------------------------------------------------------- benchmark
test('AnalyzeBenchmark computes metrics; empty -> insufficient', () => {
  const uc = new AnalyzeBenchmark();
  const ok = uc.execute(OWNER, { benchmark: { results: [
    { expected: 'deliverable', predicted: 'deliverable' },
    { expected: 'undeliverable', predicted: 'undeliverable' },
  ] } });
  assert.equal(ok.available, true);
  assert.equal(uc.execute(OWNER, { benchmark: { results: [] } }).available, false);
});
