// Pure formatting/geometry helpers shared across views (no DOM, no JSX).

export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--safe)';
  if (score >= 60) return 'var(--review)';
  if (score >= 35) return 'var(--catchall)';
  return 'var(--remove)';
}

export function riskColor(level?: string): string {
  return (
    ({ LOW: 'var(--safe)', MEDIUM: 'var(--review)', HIGH: 'var(--remove)' } as Record<string, string>)[
      level || ''
    ] || 'var(--muted)'
  );
}

export function statusLabel(s: string): string {
  return (
    ({ pending: 'Not verified', verifying: 'Verifying…', done: 'Verified' } as Record<string, string>)[
      s
    ] || s
  );
}

export const ACTION_STYLE: Record<string, { label: string; color: string }> = {
  keep: { label: 'KEEP', color: 'var(--safe)' },
  review: { label: 'REVIEW', color: 'var(--review)' },
  reverify: { label: 'REVERIFY', color: 'var(--catchall)' },
  remove: { label: 'REMOVE', color: 'var(--remove)' },
};

export const DELIV_STYLE: Record<string, { label: string; color: string }> = {
  deliverable: { label: 'Deliverable', color: 'var(--safe)' },
  // Catch-all: server accepts arbitrary recipients — mailbox NOT confirmed.
  // Labelled explicitly so it is never mistaken for confirmed deliverability.
  accepted: { label: 'Catch-All · unconfirmed', color: 'var(--catchall)' },
  // Legacy rows may still say risky for catch-all until re-verified.
  risky: { label: 'Catch-All · unconfirmed', color: 'var(--catchall)' },
  unknown: { label: 'Unknown · unconfirmed', color: 'var(--unknown)' },
  undeliverable: { label: 'Undeliverable', color: 'var(--remove)' },
};

export const CONF_COLOR: Record<string, string> = {
  high: 'var(--safe)',
  medium: 'var(--review)',
  low: 'var(--catchall)',
  unknown: 'var(--unknown)',
};

export const CAL_LEVEL_COLOR: Record<string, string> = {
  HIGH: 'var(--safe)',
  MEDIUM: 'var(--review)',
  LOW: 'var(--catchall)',
};

// Deterministic confidence -> (LEVEL, percent). Mirrors the backend calibrator's
// DET_CONF fallback (server/agent/intelligence/calibration/calibrator.js) so the
// UI can show the engine's own confidence as a number when no ML model exists.
export const DET_CONF_MAP: Record<string, { level: 'HIGH' | 'MEDIUM' | 'LOW'; pct: number }> = {
  high: { level: 'HIGH', pct: 92 },
  medium: { level: 'MEDIUM', pct: 75 },
  low: { level: 'LOW', pct: 50 },
  unknown: { level: 'LOW', pct: 40 },
};

export function deterministicConfidence(confidence?: string): { level: 'HIGH' | 'MEDIUM' | 'LOW'; pct: number } | null {
  if (!confidence) return null;
  return DET_CONF_MAP[confidence.toLowerCase()] || null;
}
