// Tests for the deterministic list-health module (score, aggregation, provider
// classification, risk signals, recommendations). Pure — no I/O, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListHealth, healthLevel, classifyProvider, HEALTH_WEIGHTS,
} from '../list-health.js';

// Minimal contact row factory matching engine output shape.
function contact(email, deliverability, over = {}) {
  return {
    email,
    deliverability,
    status: deliverability,
    classification: over.classification || ({
      deliverable: 'safe', accepted: 'safe', undeliverable: 'remove', unknown: 'unknown', risky: 'review',
    }[deliverability] || 'unknown'),
    riskSignals: over.riskSignals || [],
    signals: over.signals || [],
    verified_at: over.verified_at ?? new Date().toISOString(),
    finalReason: over.finalReason,
  };
}

// ---- Health level labels ---------------------------------------------------
test('healthLevel maps score ranges to product labels', () => {
  assert.equal(healthLevel(100), 'Excellent');
  assert.equal(healthLevel(90), 'Excellent');
  assert.equal(healthLevel(89), 'Good');
  assert.equal(healthLevel(75), 'Good');
  assert.equal(healthLevel(74), 'Needs Attention');
  assert.equal(healthLevel(60), 'Needs Attention');
  assert.equal(healthLevel(59), 'Poor');
  assert.equal(healthLevel(40), 'Poor');
  assert.equal(healthLevel(39), 'Critical');
  assert.equal(healthLevel(0), 'Critical');
});

// ---- Provider classification ----------------------------------------------
test('classifyProvider maps known families and falls back to corporate/other', () => {
  assert.equal(classifyProvider('gmail.com'), 'gmail');
  assert.equal(classifyProvider('googlemail.com'), 'gmail');
  assert.equal(classifyProvider('outlook.com'), 'outlook');
  assert.equal(classifyProvider('hotmail.com'), 'outlook');
  assert.equal(classifyProvider('yahoo.com'), 'yahoo');
  assert.equal(classifyProvider('acme-corp.io'), 'corporate/other');
  assert.equal(classifyProvider('temp.example', { disposable: true }), 'disposable');
  assert.equal(classifyProvider(''), 'unknown');
});

// ---- Empty list ------------------------------------------------------------
test('empty list -> neutral 100 / Excellent, zero metrics, no divide-by-zero', () => {
  const r = buildListHealth({ contacts: [] });
  assert.equal(r.healthScore, 100);
  assert.equal(r.healthLevel, 'Excellent');
  assert.equal(r.metrics.total, 0);
  assert.equal(r.metrics.percentages.deliverable, 0);
  assert.equal(r.metrics.percentages.undeliverable, 0);
  assert.deepEqual(r.riskSignals, []);
});

// ---- All deliverable -------------------------------------------------------
test('all deliverable -> score 100, Excellent, deliverable 100%', () => {
  const contacts = Array.from({ length: 10 }, (_, i) => contact(`u${i}@gmail.com`, 'deliverable'));
  const r = buildListHealth({ contacts });
  assert.equal(r.healthScore, 100);
  assert.equal(r.healthLevel, 'Excellent');
  assert.equal(r.metrics.percentages.deliverable, 100);
  assert.equal(r.metrics.undeliverable, 0);
});

// ---- All undeliverable -----------------------------------------------------
test('all undeliverable -> score floors at 0, Critical', () => {
  const contacts = Array.from({ length: 10 }, (_, i) => contact(`u${i}@dead.example`, 'undeliverable'));
  const r = buildListHealth({ contacts });
  assert.equal(r.metrics.percentages.undeliverable, 100);
  assert.equal(r.healthScore, 0, '100% undeliverable x weight 1.0 => 100 penalty => score 0');
  assert.equal(r.healthLevel, 'Critical');
  assert.equal(r.riskSignals[0].code, 'undeliverable');
  assert.equal(r.riskSignals[0].severity, 'high');
});

// ---- Mixed results + explainable score -------------------------------------
test('mixed list produces explainable, deterministic score with components', () => {
  // 100 contacts: 80 deliverable, 10 undeliverable, 5 unknown, 5 accept-all.
  const contacts = [
    ...Array.from({ length: 80 }, (_, i) => contact(`d${i}@gmail.com`, 'deliverable')),
    ...Array.from({ length: 10 }, (_, i) => contact(`x${i}@dead.example`, 'undeliverable')),
    ...Array.from({ length: 5 }, (_, i) => contact(`u${i}@slow.example`, 'unknown')),
    ...Array.from({ length: 5 }, (_, i) => contact(`a${i}@catchall.example`, 'accepted', { riskSignals: [{ code: 'catch_all' }] })),
  ];
  const r = buildListHealth({ contacts });

  assert.equal(r.metrics.total, 100);
  assert.equal(r.metrics.percentages.deliverable, 80);
  assert.equal(r.metrics.percentages.undeliverable, 10);
  assert.equal(r.metrics.percentages.unknown, 5);
  assert.equal(r.metrics.percentages.acceptAll, 5);

  // Expected weightedRisk = 10*1.0 (undeliverable) + 5*0.15 (unknown) + 5*0.0 (acceptAll)
  //                       = 10 + 0.75 + 0 = 10.75  => score ~89.25 (acceptAll no longer penalised)
  const expected = 100 - (10 * HEALTH_WEIGHTS.undeliverable + 5 * HEALTH_WEIGHTS.unknown + 5 * HEALTH_WEIGHTS.acceptAll);
  assert.ok(Math.abs(r.healthScore - expected) < 0.2, `score ${r.healthScore} ~= ${expected}`);
  assert.equal(r.healthLevel, 'Good');

  // Score is explainable: components sum to weightedRisk.
  const sum = r.scoreModel.components.reduce((s, c) => s + c.penalty, 0);
  assert.ok(Math.abs(sum - r.scoreModel.weightedRisk) < 0.2);
  assert.ok(r.scoreModel.formula.includes('100 -'));
});

test('score is deterministic (same input -> same score)', () => {
  const contacts = [
    ...Array.from({ length: 7 }, (_, i) => contact(`d${i}@gmail.com`, 'deliverable')),
    ...Array.from({ length: 3 }, (_, i) => contact(`x${i}@dead.example`, 'undeliverable')),
  ];
  const a = buildListHealth({ contacts });
  const b = buildListHealth({ contacts });
  assert.equal(a.healthScore, b.healthScore);
  assert.deepEqual(a.metrics.percentages, b.metrics.percentages);
});

// ---- UNKNOWN barely penalised (never treated as negative) ------------------
test('a list dominated by UNKNOWN stays healthy (unknown is neutral)', () => {
  const contacts = Array.from({ length: 100 }, (_, i) => contact(`u${i}@slow.example`, 'unknown'));
  const r = buildListHealth({ contacts });
  // 100% unknown * 0.15 = 15 penalty => score 85 (Good), NOT Critical.
  assert.equal(r.healthScore, 85);
  assert.equal(r.healthLevel, 'Good');
  const unknownSig = r.riskSignals.find((s) => s.code === 'unknown');
  assert.equal(unknownSig.severity, 'low');
});

// ---- ACCEPT_ALL framed as infra signal, not undeliverable ------------------
test('accept-all is a medium/info signal, not counted as undeliverable', () => {
  const contacts = Array.from({ length: 20 }, (_, i) => contact(`a${i}@catchall.example`, 'accepted', { riskSignals: [{ code: 'catch_all' }] }));
  const r = buildListHealth({ contacts });
  assert.equal(r.metrics.undeliverable, 0);
  assert.equal(r.metrics.acceptAll, 20);
  const sig = r.riskSignals.find((s) => s.code === 'accept_all');
  assert.equal(sig.severity, 'medium');
  assert.ok(/healthy-infrastructure|not a failure/i.test(sig.detail));
});

// ---- Domain + provider breakdown -------------------------------------------
test('domain and provider breakdown aggregate correctly', () => {
  const contacts = [
    ...Array.from({ length: 8 }, (_, i) => contact(`d${i}@gmail.com`, 'deliverable')),
    ...Array.from({ length: 2 }, (_, i) => contact(`x${i}@gmail.com`, 'undeliverable')),
    ...Array.from({ length: 5 }, (_, i) => contact(`d${i}@acme.io`, 'deliverable')),
    ...Array.from({ length: 5 }, (_, i) => contact(`x${i}@acme.io`, 'undeliverable')),
  ];
  const r = buildListHealth({ contacts });
  const gmail = r.providers.find((p) => p.provider === 'gmail');
  const corp = r.providers.find((p) => p.provider === 'corporate/other');
  assert.equal(gmail.total, 10);
  assert.equal(gmail.undeliverable, 2);
  assert.equal(corp.total, 10);
  assert.equal(corp.undeliverable, 5);
  // Worst domain surfaces first (acme.io has 50% failure).
  assert.equal(r.domains[0].domain, 'acme.io');
});

// ---- Recommendations map to real evidence ----------------------------------
test('recommendations correspond to actual evidence (no fake actions)', () => {
  const clean = buildListHealth({ contacts: Array.from({ length: 5 }, (_, i) => contact(`d${i}@gmail.com`, 'deliverable')) });
  assert.equal(clean.recommendations[0].actionType, 'maintain');

  const dirty = buildListHealth({
    contacts: [
      contact('x@dead.example', 'undeliverable'),
      contact('u@slow.example', 'unknown'),
      contact('a@catchall.example', 'accepted', { riskSignals: [{ code: 'catch_all' }] }),
    ],
  });
  const types = dirty.recommendations.map((r) => r.actionType);
  assert.ok(types.includes('remove_undeliverable'));
  assert.ok(types.includes('reverify_unknown'));
  assert.ok(types.includes('review_accept_all'));
});
