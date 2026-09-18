// Domain widget: circular deliverability/health score gauge.
// Moved verbatim from components/ui.tsx (Phase 1A domain/primitive split).
import { scoreColor } from '../../lib/format';

export function ScoreRing({ score, label = 'Health' }: { score: number; label?: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  const color = scoreColor(score);
  return (
    <div className="ring">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--bg-2)" strokeWidth={12} />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
      </svg>
      <div className="val">
        <b>{score}</b>
        <small>{label}</small>
      </div>
    </div>
  );
}

// Labeled horizontal metric bar (0–100).
export function MetricBar({ label, value, color = 'var(--brand)' }: { label: string; value: number; color?: string }) {
  return (
    <div className="metric">
      <div className="row">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="bar">
        <span style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
