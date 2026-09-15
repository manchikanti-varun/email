import type { ReactNode } from 'react';
import type {
  Signal,
  RiskSignal,
  CalibratedConfidence,
  ListCounts,
  Statement,
  StatementKind,
  StatementConfidence,
} from '../types';
import { scoreColor, ACTION_STYLE, DELIV_STYLE, CONF_COLOR, CAL_LEVEL_COLOR } from '../lib/format';

// ---- Nav icons ----
const NAV_ICONS: Record<string, ReactNode> = {
  dashboard: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  lists: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1.2" /><circle cx="3.5" cy="12" r="1.2" /><circle cx="3.5" cy="18" r="1.2" />
    </svg>
  ),
  single: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  ),
  alerts: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  integrations: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  ),
  api: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  agent: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a3 3 0 0 0-3 3v0a3 3 0 0 0-3 3 3 3 0 0 0 0 6 3 3 0 0 0 3 3v0a3 3 0 0 0 6 0v0a3 3 0 0 0 3-3 3 3 0 0 0 0-6 3 3 0 0 0-3-3v0a3 3 0 0 0-3-3z" />
      <path d="M12 8v8M9 12h6" />
    </svg>
  ),
};
export function NavIcon({ route }: { route: string }) {
  return <span className="nav-ic">{NAV_ICONS[route] || null}</span>;
}

// ---- Skeletons ----
export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        {Array.from({ length: n }, (_, i) => (
          <div className="card" key={i}>
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" style={{ width: '60%', height: 26 }} />
          </div>
        ))}
      </div>
      <div className="skeleton skeleton-card" />
    </>
  );
}
export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="card" key={i} style={{ marginBottom: 12 }}>
          <div className="skeleton skeleton-line" style={{ width: '45%' }} />
          <div className="skeleton skeleton-line short" style={{ marginBottom: 0 }} />
        </div>
      ))}
    </>
  );
}

// ---- Score ring ----
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

// ---- Metric bar ----
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

// ---- Badges ----
export function Badge({ classification }: { classification: string }) {
  return (
    <span className={`badge ${classification}`}>
      <span className={`dot ${classification}`} />
      {classification}
    </span>
  );
}

export function ActionBadge({ action }: { action?: string }) {
  const a = ACTION_STYLE[action || ''] || { label: (action || '—').toUpperCase(), color: 'var(--muted)' };
  return <span className="badge" style={{ background: `${a.color}22`, color: a.color }}>{a.label}</span>;
}

export function DeliverabilityLabel({ value }: { value?: string }) {
  const s = DELIV_STYLE[value || ''] || { label: value || '—', color: 'var(--muted)' };
  return <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>;
}

export function ConfidenceLabel({ value }: { value?: string }) {
  const color = CONF_COLOR[value || ''] || 'var(--muted)';
  return <span style={{ color, textTransform: 'capitalize' }}>{value || 'unknown'}</span>;
}

const SIGNAL_ICON: Record<string, string> = { pass: '✓', warn: '⚠', fail: '✕', info: 'i' };
export function SignalRow({ signal }: { signal: Signal }) {
  return (
    <div className={`signal ${signal.status}`}>
      <span className="ic">{SIGNAL_ICON[signal.status] || '•'}</span>
      <span>{signal.label}</span>
    </div>
  );
}

// ---- Calibration ----
export function CalibratedConfidencePanel({ cal }: { cal?: CalibratedConfidence | null }) {
  if (!cal || typeof cal !== 'object') return null;
  const pct = Number.isFinite(cal.score) ? Math.round((cal.score as number) * 100) : null;
  const color = CAL_LEVEL_COLOR[cal.level || ''] || 'var(--muted)';

  return (
    <div className="card" style={{ marginTop: 14, background: 'var(--panel-2, transparent)' }}>
      <div className="stat-label">
        MailHealth confidence in this result{' '}
        {cal.available ? (
          <span className="pill" style={{ marginLeft: 6 }} title="Calibration model version">
            {cal.model || 'ml'}
          </span>
        ) : (
          <span className="pill" style={{ marginLeft: 6, opacity: 0.7 }} title="ML model unavailable — showing deterministic confidence">
            deterministic
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '4px 0' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color }}>{pct == null ? '—' : pct + '%'}</span>
        <span style={{ color, fontWeight: 600 }}>{cal.level || '—'}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{cal.interpretation || ''}</div>
      {cal.evidence && cal.evidence.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 2, listStyle: 'none', fontSize: 12 }}>
          {cal.evidence.slice(0, 6).map((e, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              <span style={{ color: e.sign === '+' ? 'var(--safe)' : 'var(--catchall)', fontWeight: 700 }}>{e.sign}</span>{' '}
              {e.text}
            </li>
          ))}
        </ul>
      )}
      {cal.disagreement && cal.disagreement.warning && (
        <div className="reasons" style={{ borderColor: 'var(--catchall)', marginTop: 8 }}>
          <b>⚠ Review / calibration case:</b> {cal.disagreement.warning}
        </div>
      )}
      {cal.available === false && cal.message && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{cal.message.replace(/\n/g, ' · ')}</div>
      )}
    </div>
  );
}

export function CalibratedBadge({ cal }: { cal?: CalibratedConfidence | null }) {
  if (!cal || typeof cal !== 'object' || cal.level == null) return null;
  const pct = Number.isFinite(cal.score) ? Math.round((cal.score as number) * 100) : null;
  const color = CAL_LEVEL_COLOR[cal.level] || 'var(--muted)';
  const title = cal.available ? `Calibrated (${cal.model || 'ml'})` : 'Deterministic fallback';
  return (
    <span className="pill" title={title} style={{ color }}>
      {cal.level}
      {pct == null ? '' : ' ' + pct + '%'}
    </span>
  );
}

// ---- Risk chips ----
export function RiskChips({ riskSignals }: { riskSignals?: RiskSignal[] }) {
  if (!riskSignals || !riskSignals.length) return <span className="muted">None detected</span>;
  return (
    <>
      {riskSignals.map((r, i) => (
        <span key={i} className="pill" title={r.detail || ''} style={{ margin: '2px 4px 2px 0' }}>
          {r.label}
        </span>
      ))}
    </>
  );
}

// ---- Line chart ----
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

// ---- Stacked bar ----
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

// ---- AI statement vocabulary ----
export function KindTag({ kind }: { kind: StatementKind }) {
  const cls =
    ({ FACT: 'safe', INFERENCE: 'brand', PREDICTION: 'review', RECOMMENDATION: 'brand-2' } as Record<string, string>)[kind] || 'muted';
  return <span className="pill" style={{ background: `var(--${cls})`, color: '#0b0f17', fontSize: 10 }}>{kind}</span>;
}
export function ConfTag({ c }: { c?: StatementConfidence }) {
  if (!c) return null;
  const color = ({ HIGH: 'var(--safe)', MEDIUM: 'var(--review)', LOW: 'var(--muted)' } as Record<string, string>)[c] || 'var(--muted)';
  return <span className="muted" style={{ fontSize: 11, color }}> · {c}</span>;
}
export function StmtList({ items }: { items?: Statement[] }) {
  if (!items || !items.length) return null;
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 2, listStyle: 'none' }}>
      {items.map((s, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          <KindTag kind={s.kind} />
          <ConfTag c={s.confidence} />
          <br />
          {s.text}
        </li>
      ))}
    </ul>
  );
}
