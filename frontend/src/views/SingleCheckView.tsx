import { useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  ScoreRing,
  ActionBadge,
  DeliverabilityLabel,
  ConfidenceLabel,
  RiskChips,
  SignalRow,
  CalibratedConfidencePanel,
  CalibratedBadge,
} from '../components/ui';
import type { VerifyResult } from '../types';

function SingleResult({ r }: { r: VerifyResult }) {
  return (
    <>
      <div className="ring-wrap" style={{ margin: '16px 0' }}>
        <ScoreRing score={r.deliverabilityScore ?? r.score ?? 0} label="Deliverability" />
        <div>
          <div className="email-cell" style={{ marginBottom: 8 }}>{r.email}</div>
          <div>
            <ActionBadge action={r.recommendedAction || r.classification} />
          </div>
        </div>
      </div>

      {/* Side-by-side: deterministic verdict (rules) and the ML calibrated
          confidence (additive reliability estimate). */}
      <div className="grid cols-2" style={{ margin: '8px 0 16px', gap: 12 }}>
        <div className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
          <div className="stat-label">
            Deterministic verdict <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>RULES</span>
          </div>
          <div style={{ margin: '6px 0 4px' }}>
            <DeliverabilityLabel value={r.deliverability || r.status} />
          </div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            Evidence confidence: <ConfidenceLabel value={r.confidence} />
          </div>
          <ActionBadge action={r.recommendedAction || r.classification} />
        </div>
        <div className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
          <div className="stat-label">
            AI confidence <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>ML</span>
          </div>
          <div style={{ margin: '6px 0 4px' }}>
            {r.confidenceCalibration && r.confidenceCalibration.level ? (
              <CalibratedBadge cal={r.confidenceCalibration} />
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>Not available</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            How reliable the verdict is. This never overrides the deterministic result.
          </div>
        </div>
      </div>

      <div className="stat-label">Risk signals</div>
      <div style={{ margin: '4px 0 14px' }}>
        <RiskChips riskSignals={r.riskSignals} />
      </div>

      <CalibratedConfidencePanel cal={r.confidenceCalibration} />

      <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Technical evidence</h3>
      {(r.signals || []).map((s, i) => (
        <SignalRow key={i} signal={s} />
      ))}
      <div className="reasons">
        <b>Why this classification?</b>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(r.reasons || []).map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
      <div className="recommendation">
        <b>Recommended action:</b> {r.recommendation}
      </div>
    </>
  );
}

export function SingleCheckView() {
  const { setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function run() {
    const value = email.trim();
    if (!value) return;
    setResult(null);
    setError('');
    setPending(true);
    setBusy(true);
    try {
      const { result: r, user } = await api.verifySingle(value);
      setUser(user);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Single Email Check</h1>
      <p className="page-sub">Verify one address and see the full explanation. Costs 1 credit.</p>
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="toolbar">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && run()}
            placeholder="name@company.com"
            style={{ flex: 1 }}
          />
          <button className="btn" disabled={busy} onClick={run}>
            Verify
          </button>
        </div>
        <div>
          {pending && <p className="muted">Verifying…</p>}
          {error && <p className="error">{error}</p>}
          {result && <SingleResult r={result} />}
        </div>
      </div>
    </>
  );
}
