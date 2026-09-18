// Domain visualizations: list-health line chart and classification stacked bar.
// Moved verbatim from components/ui.tsx (Phase 1A domain/primitive split).
import type { ListCounts } from '../../types';
import { scoreColor } from '../../lib/format';

export function LineChart({ points, width = 520, height = 160 }: { points: { x: string; y: number }[]; width?: number; height?: number }) {
  const pad = 28;
  if (!points.length) return <p className="muted">No history yet.</p>;
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 100);
  const range = maxY - minY || 1;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const px = (i: number) => pad + i * stepX;
  const py = (v: number) => height - pad - ((v - minY) / range) * (height - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const gridVals = [0, 25, 50, 75, 100];
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width }}>
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={pad} y1={py(v)} x2={width - pad} y2={py(v)} stroke="var(--border)" strokeDasharray="3 4" />
          <text x={4} y={py(v) + 3} fill="var(--muted)" fontSize={9}>{v}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={i} cx={px(i).toFixed(1)} cy={py(p.y).toFixed(1)} r={3.5} fill={scoreColor(p.y)} />
      ))}
    </svg>
  );
}

export function StackedBar({ counts, total }: { counts: ListCounts; total: number }) {
  if (!total) return null;
  const seg = (n: number, color: string, label: string) =>
    n ? <div key={label} title={`${label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: color, height: '100%' }} /> : null;
  return (
    <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {seg(counts.safe, 'var(--safe)', 'Safe')}
      {seg(counts.review, 'var(--review)', 'Review')}
      {seg(counts.unknown, 'var(--unknown)', 'Unknown')}
      {seg(counts.remove, 'var(--remove)', 'Remove')}
    </div>
  );
}
