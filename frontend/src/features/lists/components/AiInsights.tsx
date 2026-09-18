// Deterministic-first AI insights for a list: campaign risk, health analysis,
// domains to watch, health forecast, and anomalies. Each sub-request fails
// soft (null) and renders an honest "not available yet" state — no fabricated
// insights. Extracted from ListDetailView's AiInsightsCard.
import { useEffect, useState } from 'react';
import { useNavigate } from '../../../lib/useHashRoute';
import { riskColor } from '../../../lib/format';
import { KindTag, ConfTag, StmtList } from '../../../components/domain';
import type {
  CampaignRisk,
  HealthAnalysis,
  DomainsResult,
  HealthPrediction,
  AnomaliesResult,
} from '../../../types';
import { listsApi } from '../services/lists-api';

export function AiInsights({ id }: { id: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<{
    loading: boolean;
    risk: CampaignRisk | null;
    health: HealthAnalysis | null;
    domains: DomainsResult | null;
    forecast: HealthPrediction | null;
    anomalies: AnomaliesResult | null;
  }>({ loading: true, risk: null, health: null, domains: null, forecast: null, anomalies: null });

  useEffect(() => {
    Promise.all([
      listsApi.aiCampaignRisk(id).catch(() => null),
      listsApi.aiHealthAnalysis(id).catch(() => null),
      listsApi.aiDomains(id).catch(() => null),
      listsApi.aiHealthPrediction(id).catch(() => null),
      listsApi.aiAnomalies(id).catch(() => null),
    ]).then(([risk, health, domains, forecast, anomalies]) =>
      setState({ loading: false, risk, health, domains, forecast, anomalies }),
    );
  }, [id]);

  const { loading, risk, health, domains, forecast, anomalies } = state;
  const hasData = risk || health;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>🧠 AI Insights</h3>
        <div className="spacer" />
        <span
          className="pill"
          title="Deterministic analysis on top of the verification engine. AI never changes verification results."
        >
          deterministic-first
        </span>
      </div>

      {loading ? (
        <p className="muted">Analyzing…</p>
      ) : !hasData ? (
        <p className="muted">AI insights become available once the list is verified.</p>
      ) : (
        <>
          <div className="grid cols-2">
            {/* Campaign risk */}
            <div>
              {risk && risk.available ? (
                <>
                  <div className="stat-label">Campaign risk</div>
                  <div className="stat" style={{ color: riskColor(risk.riskLevel) }}>{risk.riskLevel}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    score {risk.riskScore}/100 · recommended send {risk.recommendedSendCount?.toLocaleString()}
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 13 }}>{risk.summary || ''}</p>
                </>
              ) : (
                <>
                  <div className="stat-label">Campaign risk</div>
                  <p className="muted">{risk?.message || 'Not available yet.'}</p>
                </>
              )}
            </div>

            {/* Health analysis */}
            <div>
              {health && health.available ? (
                <>
                  <div className="stat-label">Health analysis</div>
                  <div style={{ fontSize: 15, margin: '2px 0' }}>
                    <b>{health.healthScore}/100</b>{' '}
                    <span className="muted">
                      {({ IMPROVING: '▲', DECLINING: '▼', STABLE: '■' } as Record<string, string>)[health.trend || ''] || ''}{' '}
                      {health.trend}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 13 }}>{health.summary || ''}</p>
                  <StmtList items={health.recommendations} />
                </>
              ) : (
                <>
                  <div className="stat-label">Health analysis</div>
                  <p className="muted">{health?.summary || 'Not available yet.'}</p>
                </>
              )}
            </div>

            {/* Domains */}
            <div>
              <div className="stat-label">Domains to watch</div>
              {domains && domains.available && domains.domains.length ? (
                domains.domains.slice(0, 4).map((d, i) => (
                  <div key={i} className="signal" title={d.summary || d.recommendedAction}>
                    <span
                      className="dot"
                      style={{ background: riskColor(d.problemScore >= 30 ? 'HIGH' : d.problemScore >= 15 ? 'MEDIUM' : 'LOW') }}
                    />
                    {i + 1}. {d.domain} <span className="muted">({d.total})</span>
                  </div>
                ))
              ) : (
                <p className="muted">No standout domains.</p>
              )}
            </div>

            {/* Forecast */}
            <div>
              {forecast && forecast.available ? (
                <>
                  <div className="stat-label">
                    Health forecast <KindTag kind="PREDICTION" />
                    <ConfTag c={forecast.confidence} />
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Current {forecast.currentScore} · {forecast.trend}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    30d: <b>{forecast.predictionRanges?.['30d'] || '—'}</b> · 60d:{' '}
                    <b>{forecast.predictionRanges?.['60d'] || '—'}</b> · 90d:{' '}
                    <b>{forecast.predictionRanges?.['90d'] || '—'}</b>
                  </div>
                  {forecast.warning && (
                    <p className="error" style={{ fontSize: 12, marginTop: 6 }}>⚠ {forecast.warning}</p>
                  )}
                  <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>{forecast.note || ''}</p>
                </>
              ) : (
                <>
                  <div className="stat-label">Health forecast</div>
                  <p className="muted">{forecast?.message || 'Insufficient historical data for a forecast.'}</p>
                </>
              )}
            </div>
          </div>

          {anomalies && anomalies.available && anomalies.detected && (
            <div style={{ marginTop: 12 }}>
              {anomalies.anomalies.map((an, i) => (
                <div key={i} className="banner-warn" style={{ marginTop: 8 }}>
                  <span>
                    <b>Anomaly:</b> {an.statement?.text || an.metric + ' changed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="btn ghost sm" onClick={() => navigate('#/agent/' + id)}>
          Ask MailHealth AI about this list →
        </button>
      </div>
    </div>
  );
}
