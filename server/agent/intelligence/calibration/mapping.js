// ML Confidence Calibration — Probability → confidence-level mapping.
//
// PURE module. Turns a calibrated probability P(correct) into a HIGH/MEDIUM/LOW
// level. Thresholds are NOT hard-coded blindly: selectThresholds() picks them
// from VALIDATION data (maximising per-bucket correctness separation) and the
// chosen values are stored WITH the model. defaultThresholds documents the
// starting point; they must be tuned and justified against validation data.

// Documented starting point (task §11). These are only used when a model has
// not supplied validated thresholds. They are intentionally conservative.
export const DEFAULT_THRESHOLDS = Object.freeze({ high: 0.90, medium: 0.70 });

// Uppercase to match the intelligence layer's statement CONFIDENCE vocabulary.
export const LEVEL = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });

/**
 * Map a probability to a level using explicit thresholds.
 * @param {number} p in [0,1]
 * @param {{high:number,medium:number}} [thresholds]
 */
export function toLevel(p, thresholds = DEFAULT_THRESHOLDS) {
  const hi = thresholds?.high ?? DEFAULT_THRESHOLDS.high;
  const md = thresholds?.medium ?? DEFAULT_THRESHOLDS.medium;
  if (!Number.isFinite(p)) return LEVEL.LOW;
  if (p >= hi) return LEVEL.HIGH;
  if (p >= md) return LEVEL.MEDIUM;
  return LEVEL.LOW;
}

/**
 * Select thresholds from validation predictions so that each level's observed
 * correctness roughly matches its intended band. We scan candidate cut points
 * and choose the pair that (a) keeps HIGH-band observed correctness >= target
 * and (b) maximises coverage. Fully deterministic and documented.
 *
 * @param {Array<{p:number,y:0|1}>} valPreds
 * @param {object} [opts]
 * @param {number} [opts.highTarget=0.9] required observed correctness in HIGH band
 * @param {number} [opts.mediumTarget=0.7]
 */
export function selectThresholds(valPreds, opts = {}) {
  const rows = (valPreds || []).filter((r) => r && Number.isFinite(r.p) && (r.y === 0 || r.y === 1));
  const highTarget = opts.highTarget ?? 0.9;
  const mediumTarget = opts.mediumTarget ?? 0.7;
  if (rows.length < 20) {
    return { ...DEFAULT_THRESHOLDS, source: 'default', reason: 'insufficient-validation-data', samples: rows.length };
  }

  const candidates = [];
  for (let t = 0.5; t <= 0.99; t = Math.round((t + 0.01) * 100) / 100) candidates.push(t);

  // Highest cut whose HIGH-band correctness >= target and band non-trivial.
  let high = DEFAULT_THRESHOLDS.high;
  for (const t of candidates.slice().reverse()) {
    const band = rows.filter((r) => r.p >= t);
    if (band.length < Math.max(5, rows.length * 0.05)) continue;
    const corr = band.reduce((a, r) => a + r.y, 0) / band.length;
    if (corr >= highTarget) { high = t; break; }
  }
  // Medium cut: lower than high, MEDIUM+ band correctness >= mediumTarget.
  let medium = DEFAULT_THRESHOLDS.medium;
  for (const t of candidates) {
    if (t >= high) break;
    const band = rows.filter((r) => r.p >= t);
    if (band.length < Math.max(5, rows.length * 0.05)) continue;
    const corr = band.reduce((a, r) => a + r.y, 0) / band.length;
    if (corr >= mediumTarget) { medium = t; break; }
  }
  if (medium >= high) medium = Math.max(0.5, high - 0.15);

  return {
    high: Math.round(high * 100) / 100,
    medium: Math.round(medium * 100) / 100,
    source: 'validation',
    highTarget, mediumTarget,
    samples: rows.length,
    rationale: `HIGH >= ${Math.round(high * 100)}% (observed correctness >= ${Math.round(highTarget * 100)}% in that band); ` +
      `MEDIUM >= ${Math.round(medium * 100)}% (observed correctness >= ${Math.round(mediumTarget * 100)}%); below that LOW. ` +
      'Chosen from validation data, not assumed.',
  };
}
