// Contact entity helpers. Maps a raw persistence row into the shape the
// application/UI expect, parsing JSON columns and exposing camelCase aliases.

export function toDomainContact(row) {
  return {
    ...row,
    greylisted: !!row.greylisted,
    signals: safeParse(row.signals),
    reasons: safeParse(row.reasons),
    riskSignals: safeParse(row.risk_signals),
    recommendedAction: row.recommended_action,
    // ML calibration (additive; present only after a calibrated verification).
    calibratedConfidence: row.calibrated_confidence ?? null,
    calibrationLevel: row.calibration_level ?? null,
    calibrationModel: row.calibration_model ?? null,
  };
}

function safeParse(v) {
  try { return JSON.parse(v || '[]'); } catch { return []; }
}
