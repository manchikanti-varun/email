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
  risky: { label: 'Catch-all', color: 'var(--catchall)' },
  unknown: { label: 'Unconfirmed', color: 'var(--unknown)' },
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
