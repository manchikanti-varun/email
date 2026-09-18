// Lists feature helpers/types.
//
// Small pure helpers shared by the contacts table and detail. Reuses the shared
// Contact / CalibratedConfidence types — no duplication, no `any`.
import type { CalibratedConfidence, Contact } from '../../types';

// True when a trained ML model produced this contact's calibration (not the
// deterministic fallback that just re-encodes the engine's own confidence).
export function hasRealMl(c: Contact): boolean {
  return !!(c.calibrationLevel && c.calibrationModel && c.calibrationModel !== 'deterministic-fallback');
}

// Build a CalibratedConfidence view object from a contact row's fields.
export function calFromContact(c: Contact): CalibratedConfidence | undefined {
  if (!c.calibrationLevel) return undefined;
  return {
    level: c.calibrationLevel,
    score: c.calibratedConfidence,
    model: c.calibrationModel,
    available: !!(c.calibrationModel && c.calibrationModel !== 'deterministic-fallback'),
    interpretation: '',
    evidence: [],
  };
}

// Contact table filter values (mirror the classification vocabulary).
export type ContactFilter = 'all' | 'safe' | 'review' | 'remove' | 'unknown';
