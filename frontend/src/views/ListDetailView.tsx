import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useNavigate } from '../lib/useHashRoute';
import { toast } from '../components/Toaster';
import { Modal } from '../components/Modal';
import {
  ScoreRing,
  MetricBar,
  StackedBar,
  ActionBadge,
  DeliverabilityLabel,
  ConfidenceLabel,
  RiskChips,
  SignalRow,
  CalibratedConfidencePanel,
  CalibratedBadge,
  ConfidencePanel,
  LineChart,
  KindTag,
  ConfTag,
  StmtList,
} from '../components/ui';
import { scoreColor, riskColor, deterministicConfidence } from '../lib/format';
import type {
  ListDetail,
  Contact,
  Progress,
  Preflight,
  CampaignRisk,
  HealthAnalysis,
  DomainsResult,
  HealthPrediction,
  AnomaliesResult,
  RiskSignal,
  HistoryPoint,
  CalibratedConfidence,
} from '../types';

// ---- Progress polling ----
function ProgressCard({ name, progress }: { name: string; progress: Progress | null }) {
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <>
      <h1 className="page-title">{name}</h1>
      <div className="card">
        <h3>Verifying…</h3>
        <div className="progress-outer">
          <div className="progress-inner" style={{ width: pct + '%' }} />
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {progress
            ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} verified (${pct}%)`
            : 'Starting…'}
        </p>
      </div>
    </>
  );
}

// ---- Risk summary cell ----
function RiskSummary({ riskSignals }: { riskSignals?: RiskSignal[] }) {
  if (!riskSignals || !riskSignals.length) return <span className="muted">—</span>;
  const first = riskSignals[0].label;
  const extra = riskSignals.length > 1 ? ` +${riskSignals.length - 1}` : '';
  return (
    <span className="pill" title={riskSignals.map((r) => r.label).join(', ')}>
      {first}
      {extra}
    </span>
  );
}

// True when a trained ML model produced this contact's calibration (not the
// deterministic fallback that just re-encodes the engine's own confidence).
function hasRealMl(c: Contact): boolean {
  return !!(c.calibrationLevel && c.calibrationModel && c.calibrationModel !== 'deterministic-fallback');
}

// AI-confidence table cell. When a trained ML model exists it shows the
// calibrated ML value; otherwise it shows the engine's OWN confidence as a
// percentage, honestly tagged "rule-based" (not ML). Never invents a number
// beyond the deterministic confidence the engine already produced.
function AiConfidenceCell({ contact }: { contact: Contact }) {
  if (hasRealMl(contact)) return <CalibratedBadge cal={calFromContact(contact)} />;
  const det = deterministicConfidence(contact.confidence);
  if (!det) return <span className="muted">—</span>;
  return (
    <span
      className="pill"
      style={{ color: 'var(--text-2)' }}
      title="The engine's own confidence in this verdict (rule-based). No ML model is deployed, so this is not an independent ML estimate."
    >
      {det.level} {det.pct}%{' '}
      <span style={{ fontSize: 9, opacity: 0.7 }}>rule-based</span>
    </span>
  );
}

// ---- Contact modal ----
function calFromContact(c: Contact): CalibratedConfidence | undefined {
  if (!c.calibrationLevel) return undefined;
  return {
    level: c.calibrationLevel,
    score: c.calibratedConfidence,
    model: c.calibrationModel,
    available: !!(c.calibrationModel && c.calibrationModel !== 'deterministic-fallback'),
    interpretation: '',
    evidence: [],
  };
}

function ContactModal({ contact, listId, onClose }: { contact: Contact; listId: string; onClose: () => void }) {
  const [cal, setCal] = useState<CalibratedConfidence | undefined>(calFromContact(contact));

  useEffect(() => {
    if (listId && contact.email) {
      api
        .aiConfidence(listId, contact.email)
        .then((res) => {
          if (res && res.confidence) setCal(res.confidence);
        })
        .catch(() => {});
    }
  }, [listId, contact.email]);

  return (
    <Modal onClose={onClose} cardStyle={{ maxWidth: 560 }}>
      <div className="toolbar">
        <h3 style={{ margin: 0 }} className="email-cell">{contact.email}</h3>
        <div className="spacer" />
        <ActionBadge action={contact.recommendedAction || contact.classification} />
      </div>

      {/* Side-by-side: the deterministic verdict (the actual result) vs. the
          ML-calibrated confidence (an additive reliability estimate). */}
      <div className="grid cols-2" style={{ margin: '14px 0', gap: 12 }}>
        <div className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
          <div className="stat-label">
            Deterministic verdict <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>RULES</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 2px' }}>
            <DeliverabilityLabel value={contact.deliverability || contact.status} />
            <span className="muted" style={{ fontSize: 11 }}>
              score {contact.deliverabilityScore ?? contact.score ?? '—'}/100
            </span>
          </div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            Evidence confidence: <ConfidenceLabel value={contact.confidence} />
          </div>
          <ActionBadge action={contact.recommendedAction || contact.classification} />
        </div>
        <ConfidencePanel cal={cal} confidence={contact.confidence} />
      </div>

      <div className="stat-label">Risk signals</div>
      <div style={{ margin: '4px 0 12px' }}>
        <RiskChips riskSignals={contact.riskSignals} />
      </div>

      <CalibratedConfidencePanel cal={cal} verdict={contact.deliverability || contact.status} />

      <h3 style={{ margin: '14px 0 6px', fontSize: 13 }}>Technical evidence</h3>
      {(contact.signals || []).map((s, i) => (
        <SignalRow key={i} signal={s} />
      ))}
      <div className="reasons">
        <b>Why this classification?</b>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(contact.reasons || []).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      <div className="recommendation">
        <b>Recommended action:</b> {contact.recommendation || ''}
      </div>
      <button className="btn ghost block" onClick={onClose} style={{ marginTop: 16 }}>
        Close
      </button>
    </Modal>
  );
}

// ---- Contacts table ----
function ContactsTable({ contacts, listId }: { contacts: Contact[]; listId: string }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Contact | null>(null);

  const query = q.trim().toLowerCase();
  const rows = contacts.filter(
    (c) => (filter === 'all' || c.classification === filter) && (!query || c.email.includes(query)),
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>Contacts</h3>
        <div className="spacer" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email…" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="safe">Safe</option>
          <option value="review">Review</option>
          <option value="remove">Remove</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No matching contacts.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th title="Deterministic verification engine — the actual verdict, never guessed.">
                  Verdict <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>RULES</span>
                </th>
                <th title="Evidence strength behind the deterministic verdict.">Confidence</th>
                <th title="How reliable the verdict is. Uses a trained ML model when one is deployed; otherwise the engine's own rule-based confidence. Never changes the verdict.">
                  Confidence&nbsp;%
                </th>
                <th>Risk signals</th>
                <th title="Recommended action derived from the deterministic verdict.">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((c, i) => (
                <tr key={i} style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                  <td className="email-cell">{c.email}</td>
                  <td>
                    <DeliverabilityLabel value={c.deliverability || c.status} />
                    <span className="muted" style={{ fontSize: 11 }}> · {c.deliverabilityScore ?? c.score ?? '—'}</span>
                  </td>
                  <td>
                    <ConfidenceLabel value={c.confidence} />
                  </td>
                  <td>
                    <AiConfidenceCell contact={c} />
                  </td>
                  <td>
                    <RiskSummary riskSignals={c.riskSignals} />
                  </td>
                  <td>
                    <ActionBadge action={c.recommendedAction || c.classification} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && (
            <p className="muted" style={{ marginTop: 10 }}>
              Showing first 500 of {rows.length}. Export for the full list.
            </p>
          )}
        </>
      )}

      {selected && <ContactModal contact={selected} listId={listId} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ---- Preflight card ----
function PreflightCard({ id }: { id: string }) {
  const [p, setP] = useState<Preflight | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.preflight(id).then(setP).catch(() => setFailed(true));
  }, [id]);
  if (failed) return null;

  const bar = (label: string, n: number, color: string) => (
    <div className="signal" key={label}>
      <span className="dot" style={{ background: color }} />
      {n.toLocaleString()} — {label}
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {!p ? (
        <>
          <h3>Campaign Preflight</h3>
          <p className="muted">Loading…</p>
        </>
      ) : (
        <>
          <div className="toolbar">
            <h3 style={{ margin: 0 }}>Campaign Preflight</h3>
            <div className="spacer" />
            <span className="pill">{p.recipients.toLocaleString()} recipients</span>
          </div>
          <div className="grid cols-2">
            <div>
              {bar('Safe', p.buckets.safe, 'var(--safe)')}
              {bar('Review', p.buckets.review, 'var(--review)')}
              {bar('Catch-all', p.buckets.catchAll, 'var(--catchall)')}
              {bar('Invalid', p.buckets.invalid, 'var(--remove)')}
              {bar('Disposable', p.buckets.disposable, 'var(--remove)')}
              {bar('Unknown', p.buckets.unknown, 'var(--unknown)')}
            </div>
            <div>
              <div className="stat-label">Recommended send list</div>
              <div className="stat" style={{ color: 'var(--safe)' }}>{p.recommendedSendList.toLocaleString()}</div>
              <div className="recommendation" style={{ marginTop: 12 }}>
                <b>Can I safely send this campaign?</b>
                <br />
                {p.verdict}
              </div>
              <a className="btn sm" style={{ marginTop: 12 }} href={api.exportUrl(id, 'campaign')}>
                Download send list
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- AI insights card ----
function AiInsightsCard({ id }: { id: string }) {
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
      api.aiCampaignRisk(id).catch(() => null),
      api.aiHealthAnalysis(id).catch(() => null),
      api.aiDomains(id).catch(() => null),
      api.aiHealthPrediction(id).catch(() => null),
      api.aiAnomalies(id).catch(() => null),
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
              <div className="stat-label">Top problem domains</div>
              {domains && domains.available && domains.domains.length ? (
                domains.domains.slice(0, 4).map((d, i) => (
                  <div
                    key={i}
                    className="signal"
                    title={d.recommendedAction}
                  >
                    <span
                      className="dot"
                      style={{ background: riskColor(d.problemScore >= 30 ? 'HIGH' : d.problemScore >= 15 ? 'MEDIUM' : 'LOW') }}
                    />
                    {i + 1}. {d.domain} <span className="muted">({d.total})</span>
                  </div>
                ))
              ) : (
                <p className="muted">No standout problem domains.</p>
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

// ---- History card ----
function HistoryCard({ history }: { history: HistoryPoint[] }) {
  const points = history.map((h) => ({ x: h.created_at, y: h.health }));
  const reversed = history.slice().reverse();
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Historical monitoring</h3>
      <LineChart points={points} />
      <table className="hist-table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>List Health</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {reversed.map((h, ri) => {
            const idx = history.length - 1 - ri;
            const prev = idx > 0 ? history[idx - 1].health : null;
            const d = prev != null ? Math.round((h.health - prev) * 10) / 10 : null;
            return (
              <tr key={ri}>
                <td>{new Date(h.created_at).toLocaleString()}</td>
                <td>
                  <b style={{ color: scoreColor(h.health) }}>{h.health}</b>
                </td>
                <td className={d == null ? 'muted' : d >= 0 ? 'delta-up' : 'delta-down'}>
                  {d == null ? '—' : (d >= 0 ? '+' : '') + d}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Schedule modal ----
function ScheduleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [days, setDays] = useState(7);
  return (
    <Modal onClose={onClose} cardStyle={{ maxWidth: 420 }}>
      <h3 style={{ marginTop: 0 }}>Schedule re-verification</h3>
      <p className="muted">Automatically re-verify this list on a recurring interval to track health over time.</p>
      <div className="field">
        <label>Interval (days)</label>
        <input type="number" value={days} min={1} onChange={(e) => setDays(parseInt(e.target.value, 10) || 7)} />
      </div>
      <div className="toolbar">
        <button
          className="btn"
          onClick={async () => {
            await api.schedule(id, days, true);
            onClose();
            toast(`Scheduled every ${days} day(s)`);
          }}
        >
          Enable
        </button>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ---- Main view ----
export function ListDetailView({ id }: { id: string }) {
  const { refreshCredits } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const d = await api.listDetail(id);
    if (d.list.status === 'verifying' || d.list.status === 'pending') {
      setVerifying(true);
      setDetail(d);
      startPolling();
    } else {
      setVerifying(false);
      setDetail(d);
    }
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await api.listProgress(id);
        setProgress(p);
        if (p.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          refreshCredits();
          const d = await api.listDetail(id);
          setVerifying(false);
          setDetail(d);
        }
      } catch {
        /* ignore transient errors */
      }
    }, 800);
  }

  useEffect(() => {
    // load() only calls setState asynchronously (after awaited fetches), so it
    // does not trigger the cascading-render pattern the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function reverify() {
    if (!confirm('Re-verify all contacts? This recharges credits for the whole list.')) return;
    try {
      await api.reverify(id);
      toast('Re-verification started');
      setProgress(null);
      setVerifying(true);
      startPolling();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start');
    }
  }

  async function purgeRemove(count: number) {
    if (!confirm(`Permanently delete ${count} "Remove" contacts?`)) return;
    const r = await api.bulkContacts(id, 'delete-by-classification', 'remove');
    toast(`Deleted ${r.deleted} contacts`);
    load();
  }

  const Back = (
    <a style={{ cursor: 'pointer' }} className="muted" onClick={() => navigate('#/lists')}>
      ← All lists
    </a>
  );

  if (!detail) {
    return (
      <>
        {Back}
        <p className="muted">Loading…</p>
      </>
    );
  }

  if (verifying) {
    return (
      <>
        {Back}
        <ProgressCard name={detail.list.name} progress={progress} />
      </>
    );
  }

  const { list, summary, contacts, history, delta } = detail;
  const m = summary.metrics;

  return (
    <>
      {Back}
      <div className="toolbar">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{list.name}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {list.total.toLocaleString()} contacts · {list.duplicates} duplicates removed ·{' '}
            {delta != null && (
              <span className={delta >= 0 ? 'delta-up' : 'delta-down'}>
                {delta >= 0 ? '▲ +' : '▼ '}
                {delta} pts since last check
              </span>
            )}
          </p>
        </div>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={reverify}>Re-verify</button>
        <button className="btn ghost sm" onClick={() => setShowSchedule(true)}>Schedule…</button>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>List Health</h3>
          <div className="ring-wrap">
            <ScoreRing score={summary.health} label="out of 100" />
            <div style={{ flex: 1 }}>
              <MetricBar label="Deliverability" value={m.deliverability} color="var(--safe)" />
              <MetricBar label="Data quality" value={m.dataQuality} color="var(--brand)" />
              <MetricBar label="Risk" value={m.risk} color="var(--review)" />
              <MetricBar label="Domain health" value={m.domainHealth} color="var(--brand-2)" />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <StackedBar counts={summary.counts} total={summary.total} />
          </div>
        </div>

        <div className="card">
          <h3>Cleaning summary</h3>
          <div className="grid cols-2">
            <div>
              <div className="stat-label">Keep (Safe)</div>
              <div className="stat" style={{ color: 'var(--safe)' }}>{summary.counts.safe}</div>
            </div>
            <div>
              <div className="stat-label">Review</div>
              <div className="stat" style={{ color: 'var(--review)' }}>{summary.counts.review}</div>
            </div>
            <div>
              <div className="stat-label">Remove</div>
              <div className="stat" style={{ color: 'var(--remove)' }}>{summary.counts.remove}</div>
            </div>
            <div>
              <div className="stat-label">Unknown</div>
              <div className="stat" style={{ color: 'var(--unknown)' }}>{summary.counts.unknown}</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }} className="toolbar">
            <a className="btn sm" href={api.exportUrl(id, 'campaign')}>Export Safe (CSV)</a>
            <a className="btn ghost sm" href={api.exportUrl(id, 'all')}>All (CSV)</a>
            <a className="btn ghost sm" href={api.exportUrl(id, 'all', 'xlsx')}>All (XLSX)</a>
            <button className="btn danger sm" onClick={() => purgeRemove(summary.counts.remove)}>
              Delete all "Remove"
            </button>
          </div>
        </div>
      </div>

      <PreflightCard id={id} />
      <AiInsightsCard id={id} />
      {history.length > 1 && <HistoryCard history={history} />}

      <ContactsTable contacts={contacts} listId={id} />

      {showSchedule && <ScheduleModal id={id} onClose={() => setShowSchedule(false)} />}
    </>
  );
}
