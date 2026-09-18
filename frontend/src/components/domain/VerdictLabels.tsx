// Domain labels/badges for verification verdicts, actions, confidence, risk and
// SMTP evidence signals. Moved verbatim from components/ui.tsx (Phase 1A split).
//
// These KNOW about the MailHealth domain (deliverability verdicts, actions,
// risk signals) and therefore live under components/domain, not components/ui.
import type { Signal, RiskSignal } from '../../types';
import { ACTION_STYLE, DELIV_STYLE, CONF_COLOR } from '../../lib/format';

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
