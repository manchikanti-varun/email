// ML Confidence Calibration — Disagreement detection.
//
// PURE module. Flags cases where the DETERMINISTIC verdict and the ML
// reliability estimate point in opposite directions, e.g. the engine says
// DELIVERABLE / REMOVE but the model's confidence in that decision is LOW.
//
// It NEVER changes the deterministic verdict. It only raises a REVIEW /
// CALIBRATION CASE so a human can re-check or reverify.

import { LEVEL } from './mapping.js';
import { inference, recommendation, CONFIDENCE } from '../common.js';

/**
 * @param {object} args
 * @param {string} args.verdict         engine deliverability ('deliverable'|'undeliverable'|'risky'|'unknown')
 * @param {string} args.recommendedAction engine action ('keep'|'review'|'remove'|'reverify')
 * @param {number} args.probability      calibrated P(correct)
 * @param {string} args.level            HIGH|MEDIUM|LOW
 * @returns {{ disagreement:boolean, severity:'none'|'soft'|'hard', reviewCase:boolean, statements:Array, warning:string|null }}
 */
export function detectDisagreement({ verdict, recommendedAction, probability, level }) {
  const v = String(verdict || '').toLowerCase();
  const action = String(recommendedAction || '').toLowerCase();
  const statements = [];

  // A "confident" deterministic verdict is one that drives an irreversible-ish
  // action (keep or remove). If the model is LOW-confidence about such a
  // verdict, that is a hard disagreement worth human review.
  const decisiveAction = action === 'keep' || action === 'remove';
  const decisiveVerdict = v === 'deliverable' || v === 'undeliverable';

  let severity = 'none';
  let warning = null;

  if (level === LEVEL.LOW && (decisiveAction || decisiveVerdict)) {
    severity = 'hard';
    warning = 'Verification evidence is internally inconsistent. Manual review or reverification recommended.';
    statements.push(inference(
      `Deterministic verdict is "${v}" (action: ${action}) but calibrated reliability is LOW ` +
      `(${Math.round((probability || 0) * 100)}%).`, CONFIDENCE.MEDIUM));
    statements.push(recommendation(
      'Treat as a REVIEW / CALIBRATION CASE: reverify where live SMTP is available before acting on this verdict.',
      CONFIDENCE.MEDIUM));
  } else if (level === LEVEL.MEDIUM && decisiveAction) {
    severity = 'soft';
    warning = 'Confidence is moderate for a decisive verdict; consider reverification for high-volume use.';
    statements.push(inference(
      `Decisive action "${action}" carries only MEDIUM calibrated reliability ` +
      `(${Math.round((probability || 0) * 100)}%).`, CONFIDENCE.MEDIUM));
  }

  const disagreement = severity !== 'none';
  return {
    disagreement,
    severity,
    reviewCase: severity === 'hard',
    statements,
    warning,
  };
}
