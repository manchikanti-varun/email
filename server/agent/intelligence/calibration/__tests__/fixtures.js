// Deterministic fixtures for the ML Confidence Calibration tests. These mimic
// the exact shape produced by the verification engine's finalize() so the
// calibration layer is exercised against realistic data — never fabricated.

import { GROUND_TRUTH_SOURCE } from '../dataset.js';

// A realistic engine result. Overrides let each test shape the evidence.
export function result(overrides = {}) {
  return {
    email: 'user@example.com',
    deliverability: 'deliverable',
    status: 'deliverable',
    deliverabilityScore: 100,
    score: 100,
    confidence: 'high',
    classification: 'safe',
    recommendedAction: 'keep',
    greylisted: false,
    provider: null,
    smtpSource: 'local-smtp',
    signals: [
      { status: 'pass', label: 'Valid syntax' },
      { status: 'pass', label: 'Domain exists' },
      { status: 'pass', label: 'MX records found' },
      { status: 'pass', label: 'SMTP server responds' },
      { status: 'pass', label: 'Mailbox confirmed to exist' },
    ],
    evidence: undefined, // engine also exposes `signals` alias; features read either
    reasons: ['The mailbox was directly confirmed to exist and can receive mail.'],
    riskSignals: [],
    verified_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function catchAllResult(overrides = {}) {
  return result({
    email: 'sales@corp.com',
    deliverability: 'risky', status: 'risky', confidence: 'medium',
    classification: 'review', recommendedAction: 'review', score: 55, deliverabilityScore: 55,
    signals: [
      { status: 'pass', label: 'Valid syntax' },
      { status: 'pass', label: 'Domain exists' },
      { status: 'pass', label: 'MX records found' },
      { status: 'pass', label: 'SMTP server responds' },
      { status: 'warn', label: 'Catch-all domain' },
    ],
    riskSignals: [{ code: 'catch_all', label: 'Catch-all domain' }],
    ...overrides,
  });
}

export function disposableResult(overrides = {}) {
  return result({
    email: 'x@mailinator.com',
    deliverability: 'undeliverable', status: 'undeliverable', confidence: 'high',
    classification: 'remove', recommendedAction: 'remove', score: 10, deliverabilityScore: 10,
    signals: [{ status: 'fail', label: 'Disposable / temporary domain' }],
    riskSignals: [{ code: 'disposable', label: 'Disposable domain' }],
    ...overrides,
  });
}

export function unknownResult(overrides = {}) {
  return result({
    email: 'y@corp.com',
    deliverability: 'unknown', status: 'unknown', confidence: 'low',
    classification: 'unknown', recommendedAction: 'reverify', score: 50, deliverabilityScore: 50,
    smtpSource: 'none',
    signals: [
      { status: 'pass', label: 'Valid syntax' },
      { status: 'pass', label: 'Domain exists' },
      { status: 'pass', label: 'MX records found' },
      { status: 'info', label: 'SMTP could not be probed (outbound port 25 unavailable)' },
    ],
    riskSignals: [],
    ...overrides,
  });
}

// Build a labelled dataset that is mostly separable so a trained model can
// achieve meaningful accuracy. Uses many distinct domains so the domain-grouped
// split populates train/val/test. Ground truth is EXPLICIT — never guessed.
export function labelledDataset(n = 180) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const domain = `d${i}.com`;
    if (i % 3 === 0) {
      // Confirmed deliverable, engine correct.
      items.push({
        result: result({ email: `a@${domain}` }),
        groundTruth: 'deliverable',
        groundTruthSource: GROUND_TRUTH_SOURCE.GROUND_TRUTH,
        email: `a@${domain}`,
      });
    } else if (i % 3 === 1) {
      // Disposable -> undeliverable, engine correct.
      items.push({
        result: disposableResult({ email: `b@${domain}` }),
        groundTruth: 'undeliverable',
        groundTruthSource: GROUND_TRUTH_SOURCE.GROUND_TRUTH,
        email: `b@${domain}`,
      });
    } else {
      // Catch-all risky; ground truth says deliverable roughly half the time,
      // so the engine's "risky" is sometimes right, sometimes not — this is
      // where calibrated confidence should be lower.
      const gt = i % 2 === 0 ? 'risky' : 'deliverable';
      items.push({
        result: catchAllResult({ email: `c@${domain}` }),
        groundTruth: gt,
        groundTruthSource: GROUND_TRUTH_SOURCE.REFERENCE,
        referenceVerdict: gt,
        email: `c@${domain}`,
      });
    }
  }
  return items;
}
