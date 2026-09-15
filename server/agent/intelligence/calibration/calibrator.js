// ML Confidence Calibration — Runtime calibrator.
//
// This is the single runtime entry point the application layer calls. It:
//   1. Extracts features from a DETERMINISTIC verification result.
//   2. Runs the trained model to estimate P(correct verdict | evidence).
//   3. Maps that probability to HIGH/MEDIUM/LOW (validated thresholds).
//   4. Detects rule-vs-ML disagreement (REVIEW / CALIBRATION CASE).
//   5. Explains the top contributing signals.
//
// SAFETY GUARANTEES (task §16, §17):
//   - It NEVER changes the deterministic verdict — it only adds a `confidence`
//     block alongside the untouched result.
//   - If the model is missing / not trained / corrupted / below the minimum
//     performance bar, it FALLS BACK to the engine's own deterministic
//     confidence. ML failure never breaks verification.
//   - It never fabricates evidence.

import { extractFeatures, evidenceBullets } from './features.js';
import { predictProba, isUsable, explainPrediction, MODEL_VERSION } from './model.js';
import { toLevel, DEFAULT_THRESHOLDS, LEVEL } from './mapping.js';
import { detectDisagreement } from './disagreement.js';

// Map the engine's lowercase confidence to the uppercase LEVEL vocabulary, and
// to a nominal probability, for the deterministic fallback path.
const DET_CONF = {
  high: { level: LEVEL.HIGH, p: 0.92 },
  medium: { level: LEVEL.MEDIUM, p: 0.75 },
  low: { level: LEVEL.LOW, p: 0.5 },
  unknown: { level: LEVEL.LOW, p: 0.4 },
};

export class ConfidenceCalibrator {
  /**
   * @param {object} [opts]
   * @param {object|null} [opts.model]  a trained model artifact (or null)
   * @param {{high:number,medium:number}} [opts.thresholds]
   * @param {number} [opts.minPerformance]  minimum accepted model accuracy (0-100) to trust ML
   */
  constructor(opts = {}) {
    this.model = opts.model || null;
    this.thresholds = opts.thresholds || this.model?.thresholds || DEFAULT_THRESHOLDS;
    this.minPerformance = opts.minPerformance ?? 0; // 0 => no gate unless configured
  }

  // Whether the ML path is currently trustworthy.
  ready() {
    if (!isUsable(this.model)) return false;
    if (this.minPerformance > 0) {
      const acc = this.model?.performance?.accuracy;
      if (Number.isFinite(acc) && acc < this.minPerformance) return false;
    }
    return true;
  }

  status() {
    if (!this.model) return { available: false, reason: 'no-model', message: 'ML Confidence Calibration: UNAVAILABLE\nReason: No trained model is loaded.' };
    if (this.model.trained === false) {
      const reason = this.model.reason || 'not-trained';
      return { available: false, reason, message: `ML Confidence Calibration: UNAVAILABLE\nReason: ${reason === 'insufficient-data' ? 'Insufficient validated benchmark samples.' : 'Model is not trained.'}` };
    }
    if (!isUsable(this.model)) return { available: false, reason: 'corrupted', message: 'ML Confidence Calibration: UNAVAILABLE\nReason: Model artifact is invalid/corrupted.' };
    if (!this.ready()) return { available: false, reason: 'below-threshold', message: 'ML Confidence Calibration: UNAVAILABLE\nReason: Model performance below minimum threshold.' };
    return { available: true, model: this.model.version, kind: this.model.kind };
  }

  /**
   * Produce a calibrated confidence block for one deterministic result.
   * The deterministic `result` object is NEVER mutated.
   *
   * @param {object} result  engine result / contact
   * @param {object} [ctx]    { previousVerdict?, now? }
   * @returns {object} confidence block (see shape below)
   */
  calibrate(result, ctx = {}) {
    const verdict = String(result?.deliverability || result?.status || 'unknown').toLowerCase();
    const recommendedAction = String(result?.recommendedAction || '').toLowerCase();

    // ---- Fallback path: deterministic confidence ----
    if (!this.ready()) {
      const det = DET_CONF[String(result?.confidence || 'unknown').toLowerCase()] || DET_CONF.unknown;
      const st = this.status();
      return {
        score: det.p,
        level: det.level,
        model: 'deterministic-fallback',
        source: 'rule-engine',
        available: false,
        reason: st.reason,
        message: st.message,
        evidence: evidenceBullets(result),
        disagreement: { disagreement: false, severity: 'none', reviewCase: false, warning: null, statements: [] },
        interpretation: 'ML calibration unavailable; showing the deterministic engine\'s own confidence. Verification is unaffected.',
      };
    }

    // ---- ML path ----
    try {
      const { vector } = extractFeatures(result, ctx);
      const p = predictProba(this.model, vector);
      const level = toLevel(p, this.thresholds);
      const contributions = explainPrediction(this.model, vector, 5);
      const dis = detectDisagreement({ verdict, recommendedAction, probability: p, level });

      return {
        score: Math.round(p * 1e4) / 1e4,
        level,
        model: this.model.version || MODEL_VERSION,
        source: 'rule+ml',
        available: true,
        thresholds: this.thresholds,
        evidence: evidenceBullets(result),
        contributions,
        disagreement: dis,
        interpretation: buildInterpretation({ verdict, level, p, dis }),
      };
    } catch (err) {
      // Any ML error => safe deterministic fallback. Never throw upward.
      const det = DET_CONF[String(result?.confidence || 'unknown').toLowerCase()] || DET_CONF.unknown;
      return {
        score: det.p,
        level: det.level,
        model: 'deterministic-fallback',
        source: 'rule-engine',
        available: false,
        reason: 'inference-error',
        message: `ML Confidence Calibration: UNAVAILABLE\nReason: inference error (${err.message}).`,
        evidence: evidenceBullets(result),
        disagreement: { disagreement: false, severity: 'none', reviewCase: false, warning: null, statements: [] },
        interpretation: 'ML calibration errored; fell back to deterministic confidence. Verification is unaffected.',
      };
    }
  }
}

function buildInterpretation({ verdict, level, p, dis }) {
  const pctText = `${Math.round((p || 0) * 100)}%`;
  if (dis.reviewCase) {
    return `The engine returned "${verdict}", but calibrated reliability is ${level} (${pctText}). ${dis.warning}`;
  }
  if (level === LEVEL.HIGH) {
    return `The evidence strongly supports the "${verdict}" classification (calibrated reliability ${pctText}).`;
  }
  if (level === LEVEL.MEDIUM) {
    return `The evidence moderately supports the "${verdict}" classification (calibrated reliability ${pctText}); some uncertainty remains.`;
  }
  return `Confidence in the "${verdict}" classification is limited (calibrated reliability ${pctText}); treat with caution.`;
}
