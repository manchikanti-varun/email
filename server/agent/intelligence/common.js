// Shared vocabulary + helpers for the AI Intelligence Layer.
//
// CORE PRINCIPLE: these modules are PURE. They receive already-fetched
// deterministic data (produced by the verification engine + repositories) and
// return interpretation. They perform NO I/O, hold NO verification logic, and
// NEVER fabricate verification results. When evidence is missing they say so.
//
// Every analytical statement is tagged with its epistemic kind so the UI and
// the user can tell verified truth from interpretation:
//   FACT           - directly observed in deterministic data
//   INFERENCE      - a logical deduction from facts (not itself measured)
//   PREDICTION     - a forecast; explicitly uncertain, never stated as fact
//   RECOMMENDATION - a suggested action
//
// Confidence is a separate axis (HIGH | MEDIUM | LOW) describing how strongly
// the evidence supports the statement.

export const KIND = Object.freeze({
  FACT: 'FACT',
  INFERENCE: 'INFERENCE',
  PREDICTION: 'PREDICTION',
  RECOMMENDATION: 'RECOMMENDATION',
});

export const CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

export const RISK_LEVEL = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

export const INSUFFICIENT = 'Insufficient evidence.';

// A tagged analytical statement.
export function stmt(kind, text, confidence = CONFIDENCE.MEDIUM) {
  return { kind, text, confidence };
}

export function fact(text) { return stmt(KIND.FACT, text, CONFIDENCE.HIGH); }
export function inference(text, confidence = CONFIDENCE.MEDIUM) { return stmt(KIND.INFERENCE, text, confidence); }
export function prediction(text, confidence = CONFIDENCE.LOW) { return stmt(KIND.PREDICTION, text, confidence); }
export function recommendation(text, confidence = CONFIDENCE.MEDIUM) { return stmt(KIND.RECOMMENDATION, text, confidence); }

// ---- Numeric helpers -------------------------------------------------------
export function clampScore(n) { return Math.max(0, Math.min(100, round1(Number(n) || 0))); }
export function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
export function pct(part, total) { return total > 0 ? round1((part / total) * 100) : 0; }
export function safeNum(n, dflt = 0) { const v = Number(n); return Number.isFinite(v) ? v : dflt; }

// Ordinary least-squares slope + intercept for points [{x, y}] where x is a
// numeric index (e.g. snapshot ordinal). Returns null if fewer than 2 points.
export function linearFit(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept, n };
}

// Domain of an email, lower-cased. Returns '' when not parseable.
export function domainOf(email) {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

// Whether a contact carries a given risk-signal code. Contacts expose
// riskSignals as [{code,label,...}] (see engine/finalize).
export function hasRisk(contact, code) {
  const rs = contact?.riskSignals;
  return Array.isArray(rs) && rs.some((r) => r && r.code === code);
}
