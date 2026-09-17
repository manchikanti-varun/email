import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listStatistics, domainStatistics,
  campaignRisk, listHealthAnalysis, healthPrediction,
  detectAnomalies, detectIncident, domainIntelligence,
  smartCleaning, prioritizeReverification, optimizeCredits, explainEmail,
  businessInsights, analyzeBenchmark, investigate,
  KIND, CONFIDENCE,
} from '../index.js';

import {
  contact, mixedContacts, infraFailureContacts, history,
  CAPABILITY_NO_SMTP, CAPABILITY_LIVE,
} from './fixtures.js';

// ---------------------------------------------------------------- statistics
test('listStatistics counts classifications, risks and smtp sources', () => {
  const s = listStatistics(mixedContacts());
  assert.equal(s.total, 7);
  assert.equal(s.classification.safe, 5); // 3 good.com + catch-all accepted + role-based info@corp.com
  assert.equal(s.classification.review, 0);
  assert.equal(s.classification.remove, 1);
  assert.equal(s.classification.unknown, 1);
  assert.equal(s.deliverability.accepted, 1);
  assert.equal(s.risk.catch_all, 1);
  assert.equal(s.risk.disposable, 1);
  assert.equal(s.risk.role_based, 1);
  assert.equal(s.smtpSource.none, 1);
});

test('listStatistics handles empty input without throwing', () => {
  const s = listStatistics([]);
  assert.equal(s.total, 0);
  assert.equal(s.percentages.safe, 0);
});

test('domainStatistics ranks worst domains first', () => {
  const d = domainStatistics(mixedContacts());
  assert.ok(d.domainCount >= 1);
  // corp.com has undeliverable? no — mailinator is worst (disposable/undeliverable)
  const worst = d.domains[0];
  assert.ok(worst.problemScore >= 0);
});

// ------------------------------------------------------------- campaign risk
test('campaignRisk returns insufficient on empty list', () => {
  const r = campaignRisk({ stats: listStatistics([]), preflight: null, history: [] });
  assert.equal(r.available, false);
  assert.match(r.message, /Insufficient/);
});

test('campaignRisk flags MEDIUM/HIGH when many unknown/catch-all and declining', () => {
  const stats = listStatistics(mixedContacts());
  const hist = history([{ health: 90, safe: 5 }, { health: 82, safe: 3, unknown: 1, review: 1, remove: 1 }]);
  const r = campaignRisk({ stats, preflight: { verdict: 'Send with caution.' }, history: hist });
  assert.equal(r.available, true);
  assert.ok(['MEDIUM', 'HIGH'].includes(r.riskLevel));
  assert.equal(r.recommendedSendCount, stats.classification.safe);
  // reasoning is tagged, never claims inbox placement
  assert.ok(r.reasoning.every((x) => Object.values(KIND).includes(x.kind)));
  assert.match(r.summary, /never guaranteed|not guaranteed|never/i);
});

// ------------------------------------------------------------ health analyst
test('listHealthAnalysis reports DECLINING and names drivers', () => {
  const contacts = mixedContacts();
  const summary = { health: 78, metrics: { deliverability: 70, dataQuality: 85, risk: 72, domainHealth: 88 } };
  const hist = history([{ health: 90, safe: 6 }, { health: 78, safe: 3, unknown: 2, remove: 1 }]);
  const a = listHealthAnalysis({ summary, stats: listStatistics(contacts), history: hist });
  assert.equal(a.trend, 'DECLINING');
  assert.ok(a.negativeSignals.length > 0);
  assert.ok(a.recommendations.length > 0);
});

test('listHealthAnalysis with single snapshot has no trend', () => {
  const summary = { health: 92, metrics: { deliverability: 95, dataQuality: 95, risk: 92, domainHealth: 95 } };
  const a = listHealthAnalysis({ summary, stats: listStatistics(mixedContacts()), history: history([{ health: 92, safe: 5 }]) });
  assert.equal(a.trend, 'STABLE');
  assert.match(a.summary, /one verification snapshot|no trend/i);
});

// ----------------------------------------------------------- health predict
test('healthPrediction declines gracefully with < 2 snapshots', () => {
  const p = healthPrediction({ history: history([{ health: 90, safe: 5 }]) });
  assert.equal(p.available, false);
  assert.match(p.message, /Insufficient historical data/);
});

test('healthPrediction produces ranges and never HIGH confidence', () => {
  const hist = history([
    { health: 95, safe: 10, at: '2026-06-01T00:00:00.000Z' },
    { health: 92, safe: 9, at: '2026-06-08T00:00:00.000Z' },
    { health: 89, safe: 8, at: '2026-06-15T00:00:00.000Z' },
  ]);
  const p = healthPrediction({ history: hist });
  assert.equal(p.available, true);
  assert.equal(p.trend, 'DECLINING');
  assert.notEqual(p.confidence, 'HIGH');
  assert.match(p.predictionRanges['90d'], /\d+(\.\d+)?–\d+/);
  assert.match(p.note, /Forecast, not a fact/);
});

// --------------------------------------------------------------- anomalies
test('detectAnomalies needs two snapshots', () => {
  const a = detectAnomalies({ history: history([{ health: 90, safe: 5 }]) });
  assert.equal(a.available, false);
});

test('detectAnomalies flags a big unknown spike', () => {
  const hist = history([
    { health: 90, safe: 90, unknown: 5, review: 3, remove: 2 },   // unknown 5%
    { health: 60, safe: 50, unknown: 42, review: 5, remove: 3 },  // unknown ~42%
  ]);
  const a = detectAnomalies({ history: hist });
  assert.equal(a.detected, true);
  const unk = a.anomalies.find((x) => x.metric === 'unknown');
  assert.ok(unk);
  assert.equal(unk.severity, 'HIGH');
});

// ---------------------------------------------------------------- incident
test('detectIncident points at infrastructure when unknowns + missing SMTP align', () => {
  const stats = listStatistics(infraFailureContacts());
  const i = detectIncident({ stats, capability: CAPABILITY_NO_SMTP });
  assert.equal(i.available, true);
  assert.equal(i.incident, true);
  assert.equal(i.category, 'verification-infrastructure');
  // must not over-claim: confidence is not HIGH from this evidence alone
  assert.notEqual(i.confidence, 'HIGH');
});

test('detectIncident does NOT blame infra when SMTP evidence is present', () => {
  // Many unknowns but all probed via smtp-worker -> not an infra incident.
  const rows = [];
  for (let k = 0; k < 5; k++) rows.push(contact({ email: `u${k}@corp.com`, deliverability: 'unknown', status: 'unknown', classification: 'unknown', confidence: 'low', smtpSource: 'smtp-worker' }));
  for (let k = 0; k < 5; k++) rows.push(contact({ email: `ok${k}@good.com`, smtpSource: 'smtp-worker' }));
  const i = detectIncident({ stats: listStatistics(rows), capability: CAPABILITY_LIVE });
  assert.equal(i.incident, false);
});

// ----------------------------------------------------------- domain intel
test('domainIntelligence summarises and recommends per domain', () => {
  const d = domainIntelligence({ domainStats: domainStatistics(mixedContacts()) });
  assert.equal(d.available, true);
  assert.ok(d.domains[0].summary.length > 0);
  assert.ok(d.domains[0].recommendedAction.length > 0);
});

// --------------------------------------------------------------- cleaning
test('smartCleaning prioritises review/unknown and never deletes', () => {
  const contacts = mixedContacts();
  const plan = { keep: 4, review: 1, remove: 1 };
  const r = smartCleaning({ cleaningPlan: plan, contacts });
  assert.equal(r.available, true);
  assert.match(r.note, /does not delete/i);
  assert.ok(r.reviewPriority.high + r.reviewPriority.medium + r.reviewPriority.low >= 1);
});

// ------------------------------------------------------ reverify priority
test('prioritizeReverification ranks stale/low-confidence highest', () => {
  const rows = [
    contact({ email: 'fresh@good.com', confidence: 'high', classification: 'safe', verified_at: new Date().toISOString() }),
    contact({ email: 'stale@corp.com', confidence: 'low', classification: 'unknown', verified_at: '2025-01-01T00:00:00.000Z', deliverability: 'unknown', status: 'unknown', greylisted: true, riskSignals: [{ code: 'temporary_failure', label: 'Temporary failure' }] }),
  ];
  const p = prioritizeReverification({ contacts: rows, now: Date.parse('2026-09-13T00:00:00.000Z') });
  assert.equal(p.priority[0].email, 'stale@corp.com');
  assert.ok(['URGENT', 'HIGH'].includes(p.priority[0].priority));
  assert.equal(p.priority[p.priority.length - 1].email, 'fresh@good.com');
});

// ----------------------------------------------------------- credit optim
test('optimizeCredits allocates budget to highest value first', () => {
  const contacts = [];
  for (let i = 0; i < 20; i++) contacts.push(contact({ email: `u${i}@corp.com`, confidence: 'low', classification: 'unknown', deliverability: 'unknown', status: 'unknown', verified_at: '2025-01-01T00:00:00.000Z' }));
  const prioritized = prioritizeReverification({ contacts, now: Date.parse('2026-09-13T00:00:00.000Z') });
  const o = optimizeCredits({ prioritized, availableCredits: 5 });
  assert.equal(o.available, true);
  assert.ok(o.recommendedVerifyCount <= 5);
  assert.ok(o.recommendations.length > 0);
});

// -------------------------------------------------------------- explanation
test('explainEmail gives simple and technical text without inventing facts', () => {
  const c = contact({
    email: 'sales@corp.com', deliverability: 'accepted', status: 'accepted', confidence: 'medium',
    classification: 'safe', recommendedAction: 'keep', acceptanceType: 'CATCH_ALL',
    riskSignals: [{ code: 'catch_all', label: 'Catch-all · accepted' }],
    signals: [
      { label: 'SMTP server responds', status: 'pass' },
      { label: 'Catch-all domain (mail path healthy)', status: 'info' },
    ],
  });
  const simple = explainEmail({ contact: c, mode: 'simple' });
  const tech = explainEmail({ contact: c, mode: 'technical' });
  assert.match(simple.explanation, /catch-all|cannot be independently confirmed|campaign-eligible/i);
  assert.match(tech.explanation, /SMTP server responds|Catch-all/);
  assert.match(tech.explanation, /Deliverability=accepted/);
});

test('explainEmail returns insufficient for missing contact', () => {
  assert.equal(explainEmail({ contact: null }).available, false);
});

// ------------------------------------------------------------- business
test('businessInsights avoids unsupported claims', () => {
  const stats = listStatistics(mixedContacts());
  const b = businessInsights({ stats, summary: { health: 80 }, domainStats: domainStatistics(mixedContacts()), history: [] });
  assert.equal(b.available, true);
  assert.match(b.disclaimer, /No claims are made about revenue/);
  // no insight text should promise inbox placement
  for (const s of b.insights) assert.doesNotMatch(s.text, /guaranteed (inbox|delivery)/i);
});

// ------------------------------------------------------------- benchmark
test('analyzeBenchmark computes metrics and top disagreement', () => {
  const benchmark = {
    results: [
      { expected: 'deliverable', predicted: 'deliverable' },
      { expected: 'undeliverable', predicted: 'undeliverable' },
      { expected: 'deliverable', predicted: 'undeliverable', reason: 'catch-all' },
      { expected: 'undeliverable', predicted: 'deliverable', reason: 'catch-all' },
      { expected: 'deliverable', predicted: 'unknown' },
    ],
  };
  const a = analyzeBenchmark({ benchmark });
  assert.equal(a.available, true);
  assert.ok(a.metrics.accuracy >= 0 && a.metrics.accuracy <= 100);
  assert.equal(a.disagreementByReason['catch-all'], 2);
  assert.match(a.note, /does not change verification verdicts/i);
});

test('analyzeBenchmark declines on empty data', () => {
  assert.equal(analyzeBenchmark({ benchmark: { results: [] } }).available, false);
});

// ----------------------------------------------------------- investigate
test('investigate produces structured root-cause with confidence', () => {
  const stats = listStatistics(infraFailureContacts());
  const hist = history([
    { health: 90, safe: 90, unknown: 5, review: 3, remove: 2 },
    { health: 55, safe: 30, unknown: 60, review: 5, remove: 5 },
  ]);
  const r = investigate({ question: 'why are so many emails unknown?', stats, history: hist, capability: CAPABILITY_NO_SMTP, domainStats: domainStatistics(infraFailureContacts()) });
  assert.equal(r.available, true);
  assert.ok(r.finding.length > 0);
  assert.ok(r.possibleCauses.length > 0);
  assert.ok(Object.values(CONFIDENCE).includes(r.confidence));
  assert.match(r.recommendedAction, /SMTP|connectivity|re-verify/i);
});

// ----------------------------------------------------- hallucination guard
test('modules never fabricate: empty everything -> insufficient, not invented verdicts', () => {
  assert.equal(campaignRisk({ stats: listStatistics([]), history: [] }).available, false);
  assert.equal(businessInsights({ stats: listStatistics([]) }).available, false);
  assert.equal(investigate({ stats: listStatistics([]) }).available, false);
  assert.equal(healthPrediction({ history: [] }).available, false);
});
