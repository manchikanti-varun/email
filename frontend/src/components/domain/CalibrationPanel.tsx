// Domain widget: ML/rule-based confidence-in-the-verdict panels and badge.
// Moved verbatim from components/ui.tsx (Phase 1A domain/primitive split).
import type { CalibratedConfidence } from '../../types';
import { DELIV_STYLE, deterministicConfidence } from '../../lib/format';

export function CalibratedConfidencePanel({ cal, verdict }: { cal?: CalibratedConfidence | null; verdict?: string }) {
  if (!cal || typeof cal !== 'object') return null;
  const pct = Number.isFinite(cal.score) ? Math.round((cal.score as number) * 100) : null;
  // Color by the VERDICT, not by the confidence magnitude — a high confidence
  // in an "undeliverable" verdict must not look green/positive. The % measures
  // how sure we are of the verdict, whatever that verdict is.
  const verdictColor = verdict ? DELIV_STYLE[verdict]?.color || 'var(--muted)' : 'var(--text)';
  const verdictLabel = verdict ? DELIV_STYLE[verdict]?.label || verdict : null;

  return (
    <div className="card" style={{ marginTop: 14, background: 'var(--panel-2, transparent)' }}>
      <div className="stat-label">
        How sure we are of the verdict{' '}
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '4px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{pct == null ? '—' : pct + '%'}</span>
        <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{cal.level || '—'}</span>
        {verdictLabel && (
          <span className="muted" style={{ fontSize: 12 }}>
            sure this is{' '}
            <span style={{ color: verdictColor, fontWeight: 600 }}>{verdictLabel}</span>
          </span>
        )}
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
  // Neutral color: this is confidence IN the verdict, not a good/bad score, so
  // it must not imply positivity (green) on its own.
  const title = cal.available
    ? `Calibrated confidence in the verdict (${cal.model || 'ml'})`
    : 'Deterministic confidence in the verdict';
  return (
    <span className="pill" title={title} style={{ color: 'var(--text-2)' }}>
      {cal.level}
      {pct == null ? '' : ' ' + pct + '%'}
    </span>
  );
}

// Confidence-in-the-verdict panel used in detail views. Shows the trained ML
// value when a model is deployed (available), otherwise the engine's own
// rule-based confidence as a percentage — clearly tagged, never faked as ML.
export function ConfidencePanel({ cal, confidence }: { cal?: CalibratedConfidence | null; confidence?: string }) {
  const hasMl = !!(cal && cal.available && cal.level);
  const det = deterministicConfidence(confidence);
  const level = hasMl ? cal!.level : det?.level;
  const pct = hasMl
    ? Number.isFinite(cal!.score) ? Math.round((cal!.score as number) * 100) : null
    : det?.pct ?? null;

  return (
    <div className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
      <div className="stat-label">
        Confidence in verdict{' '}
        <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>{hasMl ? 'ML' : 'RULE-BASED'}</span>
      </div>
      <div style={{ margin: '6px 0 4px', fontWeight: 700, color: 'var(--text)' }}>
        {level ? `${level}${pct == null ? '' : ' ' + pct + '%'}` : '—'}
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {hasMl
          ? 'Trained ML estimate of how reliable the verdict is. Never overrides it.'
          : 'The engine\u2019s own confidence in this verdict. No ML model is deployed, so this is rule-based, not an independent ML estimate.'}
      </div>
    </div>
  );
}
