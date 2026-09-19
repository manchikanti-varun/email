// AI List Health Diagnosis dashboard for a single list.
//
// Renders the deterministic health score + distribution, then the AI diagnosis
// (summary, key issues, recommended actions), plus domain and provider health.
// Everything is rendered from API data — no hard-coded values. The AI diagnosis
// is fail-safe on the backend; when the LLM is unavailable the backend returns
// a deterministic diagnosis and this component renders it the same way (only a
// small "deterministic" vs "AI" provenance pill differs).
import { ScoreRing, MetricBar } from '../../../components/domain';
import { useListHealthAnalysis } from '../hooks/useListHealthAnalysis';
import type { HealthLevel, Severity, ListHealthAnalysis } from '../../../types';

const LEVEL_COLOR: Record<HealthLevel, string> = {
  Excellent: 'var(--safe)',
  Good: 'var(--safe)',
  'Needs Attention': 'var(--review)',
  Poor: 'var(--catchall)',
  Critical: 'var(--remove)',
};

const SEV_DOT: Record<Severity, string> = {
  high: 'var(--remove)',
  medium: 'var(--catchall)',
  low: 'var(--review)',
};

const SEV_EMOJI: Record<Severity, string> = { high: '🔴', medium: '🟠', low: '🟡' };

export function ListHealthDiagnosis({ id }: { id: string }) {
  const { loading, running, analysis, error, ready, run } = useListHealthAnalysis(id);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>🩺 AI List Diagnosis</h3>
        <div className="spacer" />
        {analysis && (
          <span
            className="pill"
            title={
              analysis.diagnosisMeta.source === 'ai'
                ? 'Diagnosis narrated by the configured AI model from deterministic evidence.'
                : 'AI model unavailable — deterministic diagnosis generated from the verification evidence.'
            }
          >
            {analysis.diagnosisMeta.source === 'ai' ? 'AI diagnosis' : 'deterministic diagnosis'}
          </span>
        )}
        <button className="btn ghost sm" disabled={running} onClick={run} style={{ marginLeft: 8 }}>
          {running ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze list health'}
        </button>
      </div>

      {error && <p className="error" style={{ marginTop: 8 }}>⚠ {error}</p>}

      {loading ? (
        <p className="muted">Loading analysis…</p>
      ) : !analysis ? (
        <p className="muted">
          {ready
            ? 'Run an AI health analysis to get a plain-language diagnosis, key issues, and recommended actions for this list.'
            : 'Loading…'}
        </p>
      ) : (
        <Report analysis={analysis} />
      )}
    </div>
  );
}

function Report({ analysis }: { analysis: ListHealthAnalysis }) {
  const { healthScore, healthLevel, metrics, diagnosis, riskSignals, recommendations, domains, providers, scoreModel } = analysis;
  const p = metrics.percentages;

  return (
    <>
      {/* Overall health + distribution */}
      <div className="grid cols-2" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ScoreRing score={healthScore} label="Health" />
          <div>
            <div className="stat" style={{ color: LEVEL_COLOR[healthLevel] }}>{healthLevel}</div>
            <div className="muted" style={{ fontSize: 12 }}>{healthScore} / 100 · {metrics.total.toLocaleString()} contacts</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }} title={scoreModel.formula}>
              score = 100 − weighted risk ({scoreModel.weightedRisk})
            </div>
          </div>
        </div>
        <div>
          <Dist label="Deliverable (confirmed)" count={metrics.deliverable} pct={p.deliverable} color="var(--safe)" />
          <Dist label="Undeliverable" count={metrics.undeliverable} pct={p.undeliverable} color="var(--remove)" />
          <Dist label="Unknown / unconfirmed" count={metrics.unknown} pct={p.unknown} color="var(--unknown)" />
          <Dist label="Catch-All / unconfirmed" count={metrics.acceptAll} pct={p.acceptAll} color="var(--catchall)" />
        </div>
      </div>

      {/* AI summary */}
      <div className="banner-info" style={{ marginTop: 12 }}>
        <span>{diagnosis.summary}</span>
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        {/* Key issues */}
        <div>
          <div className="stat-label">Key issues</div>
          {diagnosis.keyIssues.length ? (
            diagnosis.keyIssues.map((k, i) => (
              <div key={i} className="signal" title={`${k.evidence} — ${k.impact}`}>
                <span className="dot" style={{ background: SEV_DOT[k.severity] }} />
                {SEV_EMOJI[k.severity]} {k.issue}
              </div>
            ))
          ) : (
            <p className="muted">No significant issues detected.</p>
          )}
        </div>

        {/* Recommended actions (deterministic; correspond to real evidence) */}
        <div>
          <div className="stat-label">Recommended actions</div>
          {recommendations.map((r, i) => (
            <div key={i} className="signal" title={r.reason}>
              <span className="dot" style={{ background: SEV_DOT[r.priority] }} />
              {i + 1}. {r.action}
            </div>
          ))}
        </div>
      </div>

      {/* Risk signals with correct UNKNOWN / ACCEPT-ALL framing */}
      {riskSignals.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="stat-label">Signals</div>
          {riskSignals.map((s, i) => (
            <div key={i} className="metric" title={s.detail}>
              <div className="row">
                <span>{SEV_EMOJI[s.severity]} {s.label}</span>
                <span>{s.count.toLocaleString()} · {s.percentage}%</span>
              </div>
              <div className="bar">
                <span style={{ width: `${Math.min(100, s.percentage)}%`, background: SEV_DOT[s.severity] }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Domain health */}
      {domains.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="stat-label">Domain health</div>
          {domains.slice(0, 6).map((d, i) => (
            <div key={i} className="signal">
              <span
                className="dot"
                style={{ background: d.problemRate >= 30 ? 'var(--remove)' : d.problemRate >= 10 ? 'var(--catchall)' : 'var(--safe)' }}
              />
              <span style={{ minWidth: 180, display: 'inline-block' }}>{d.domain}</span>
              <span className="muted">
                {d.undeliverable} failed / {d.total}
                {d.unknown > 0 ? ` · ${d.unknown} unknown` : ''}
                {d.accepted > 0 ? ` · ${d.accepted} accept-all` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Provider families */}
      {providers.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div className="stat-label">Provider families</div>
          <div className="grid cols-2">
            {providers.slice(0, 6).map((pr, i) => (
              <MetricBar
                key={i}
                label={`${pr.provider} (${pr.total})`}
                value={Math.round(100 - pr.percentages.undeliverable)}
                color="var(--safe)"
              />
            ))}
          </div>
        </div>
      )}

      {/* Observations */}
      {diagnosis.observations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="stat-label">Observations</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {diagnosis.observations.map((o, i) => (
              <li key={i} className="muted" style={{ fontSize: 13 }}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Verification results are produced by MailHealth&apos;s deterministic engine. The AI only
        interprets the evidence — it never changes a verdict, and never marks an address deliverable
        or invalid on its own.
      </p>
    </>
  );
}

function Dist({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="metric">
      <div className="row">
        <span><span className="dot" style={{ background: color, marginRight: 6 }} />{label}</span>
        <span><b>{count.toLocaleString()}</b> · {pct}%</span>
      </div>
      <div className="bar">
        <span style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}
