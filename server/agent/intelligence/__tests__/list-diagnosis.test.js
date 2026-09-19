// Tests for the AI diagnosis module: input minimization, response validation,
// and the deterministic fallback. Pure — no I/O, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAGNOSIS_SYSTEM_PROMPT, buildDiagnosisInput, validateDiagnosis,
  fallbackDiagnosis, diagnosisMeta,
} from '../list-diagnosis.js';
import { buildListHealth } from '../list-health.js';

function contact(email, deliverability, over = {}) {
  return { email, deliverability, status: deliverability, classification: over.classification || 'unknown', riskSignals: over.riskSignals || [], signals: [] };
}

function sampleReport() {
  const contacts = [
    ...Array.from({ length: 8 }, (_, i) => contact(`john.doe${i}@gmail.com`, 'deliverable', { classification: 'safe' })),
    contact('nobody@dead.example', 'undeliverable', { classification: 'remove' }),
    contact('temp@slow.example', 'unknown', { classification: 'unknown' }),
    contact('any@catchall.example', 'accepted', { classification: 'safe', riskSignals: [{ code: 'catch_all' }] }),
  ];
  return { report: buildListHealth({ contacts }), contacts };
}

// ---- Data minimization -----------------------------------------------------
test('buildDiagnosisInput sends aggregates + MASKED examples, never full addresses', () => {
  const { report, contacts } = sampleReport();
  const input = buildDiagnosisInput({ report, contacts, list: { name: 'My List', total: 11 } });

  // Aggregates present.
  assert.equal(input.healthScore, report.healthScore);
  assert.ok(input.listMetrics.total === 11 || input.listMetrics.total === report.metrics.total);
  assert.ok(Array.isArray(input.riskSignals));

  // Representative examples are masked — no full local part leaks.
  const serialized = JSON.stringify(input);
  assert.ok(!/john\.doe0@gmail\.com/.test(serialized), 'full address must not appear');
  assert.ok(/@gmail\.com/.test(serialized), 'domain may appear');
  for (const ex of input.representativeExamples) {
    assert.match(ex.email, /\*\*\*@|^.{1,2}@/, 'example email is masked');
    assert.ok(!ex.email.includes('john.doe'), 'no full local part');
  }
});

test('buildDiagnosisInput never includes secret-looking fields', () => {
  const { report, contacts } = sampleReport();
  const input = buildDiagnosisInput({ report, contacts, list: { name: 'L', total: 11 } });
  const s = JSON.stringify(input).toLowerCase();
  for (const forbidden of ['secret', 'api_key', 'apikey', 'password', 'token', 'authorization', 'bearer', 'jwt', 'encryption']) {
    assert.ok(!s.includes(forbidden), `input must not contain "${forbidden}"`);
  }
});

// ---- Validation ------------------------------------------------------------
test('validateDiagnosis accepts a well-formed response and normalizes severities', () => {
  const out = validateDiagnosis({
    summary: 'Mostly healthy.',
    keyIssues: [{ issue: 'Undeliverables', severity: 'HIGH', evidence: '1 addr', impact: 'reputation' }],
    recommendations: [{ action: 'Remove them', priority: 'high', reason: 'bounce' }],
    observations: ['gmail dominant'],
  });
  assert.ok(out);
  assert.equal(out.summary, 'Mostly healthy.');
  assert.equal(out.keyIssues[0].severity, 'high', 'severity normalized to lowercase');
  assert.equal(out.recommendations[0].priority, 'high');
  assert.equal(out.observations[0], 'gmail dominant');
});

test('validateDiagnosis rejects malformed / non-object / missing summary', () => {
  assert.equal(validateDiagnosis(null), null);
  assert.equal(validateDiagnosis('not json'), null);
  assert.equal(validateDiagnosis([1, 2, 3]), null);
  assert.equal(validateDiagnosis({}), null, 'missing summary');
  assert.equal(validateDiagnosis({ summary: '   ' }), null, 'blank summary');
});

test('validateDiagnosis strips unknown fields and caps lengths (no arbitrary markup)', () => {
  const out = validateDiagnosis({
    summary: 'x'.repeat(5000),
    keyIssues: Array.from({ length: 50 }, () => ({ issue: 'i', severity: 'weird', evidence: 'e', impact: 'p' })),
    recommendations: [{ action: 'a', priority: 'nope', reason: 'r', htmlInjection: '<script>' }],
    observations: ['o'],
    evilExtraField: '<img onerror=alert(1)>',
  });
  assert.ok(out.summary.length <= 1500, 'summary capped');
  assert.ok(out.keyIssues.length <= 10, 'keyIssues capped');
  assert.equal(out.keyIssues[0].severity, 'medium', 'invalid severity -> default medium');
  assert.equal(out.recommendations[0].priority, 'medium');
  assert.equal('htmlInjection' in out.recommendations[0], false, 'unknown fields stripped');
  assert.equal('evilExtraField' in out, false, 'unknown top-level fields stripped');
});

// ---- Deterministic fallback ------------------------------------------------
test('fallbackDiagnosis produces a usable diagnosis from the deterministic report', () => {
  const { report } = sampleReport();
  const d = fallbackDiagnosis(report);
  assert.ok(d.summary.includes(String(report.healthScore)));
  assert.ok(d.summary.includes(report.healthLevel));
  assert.ok(Array.isArray(d.keyIssues));
  assert.ok(Array.isArray(d.recommendations) && d.recommendations.length > 0);
  // Undeliverable present -> surfaced as an issue.
  assert.ok(d.keyIssues.some((k) => /undeliverable/i.test(k.issue)));
});

test('fallbackDiagnosis on an empty report is honest about insufficient data', () => {
  const report = buildListHealth({ contacts: [] });
  const d = fallbackDiagnosis(report);
  assert.match(d.summary, /no verified contacts|no health diagnosis/i);
});

test('fallbackDiagnosis frames UNKNOWN and ACCEPT_ALL correctly (not invalid)', () => {
  const contacts = [
    contact('u@slow.example', 'unknown', { classification: 'unknown' }),
    contact('a@catchall.example', 'accepted', { classification: 'safe', riskSignals: [{ code: 'catch_all' }] }),
  ];
  const report = buildListHealth({ contacts });
  const d = fallbackDiagnosis(report);
  const text = JSON.stringify(d).toLowerCase();
  assert.ok(text.includes('unconfirmed') || text.includes('re-verif'), 'unknown framed as unconfirmed');
  // It must never assert unknown IS invalid; the correct phrasing "(not invalid)" is allowed.
  assert.ok(!/unknown[^.]*\bis invalid\b/.test(text), 'never says unknown is invalid');
  assert.ok(!/unknown[^.]*does not exist/.test(text), 'never says unknown does not exist');
});

test('diagnosisMeta reports source + provenance without secrets', () => {
  const m = diagnosisMeta({ source: 'ai', model: 'gpt-x', latencyMs: 123.4, estimatedCost: 0.0002 });
  assert.equal(m.source, 'ai');
  assert.equal(m.model, 'gpt-x');
  const f = diagnosisMeta({ source: 'deterministic', error: 'timeout' });
  assert.equal(f.source, 'deterministic');
  assert.equal(f.error, 'timeout');
});

test('DIAGNOSIS_SYSTEM_PROMPT enforces the non-negotiable rules', () => {
  const p = DIAGNOSIS_SYSTEM_PROMPT.toLowerCase();
  assert.ok(p.includes('never invent'));
  assert.ok(p.includes('never override'));
  assert.ok(p.includes('unknown'));
  assert.ok(p.includes('accept_all') || p.includes('accept-all'));
  assert.ok(p.includes('json'));
});
