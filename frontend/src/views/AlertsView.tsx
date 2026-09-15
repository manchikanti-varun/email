import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useNavigate } from '../lib/useHashRoute';
import type { Alert } from '../types';

export function AlertsView() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  const load = useCallback(() => {
    api.alerts().then(({ alerts }) => setAlerts(alerts)).catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead() {
    await api.markAlertsRead();
    load();
  }

  return (
    <>
      <div className="toolbar">
        <h1 className="page-title" style={{ margin: 0 }}>Alerts</h1>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={markRead}>Mark all read</button>
      </div>
      <p className="page-sub">Health drops and data-quality changes across your lists.</p>

      {alerts == null ? (
        <p className="muted">Loading…</p>
      ) : alerts.length === 0 ? (
        <div className="empty">No alerts. Your lists are healthy.</div>
      ) : (
        alerts.map((a) => (
          <div
            key={a.id}
            className="card"
            style={{
              marginBottom: 10,
              borderLeft: `3px solid ${a.level === 'critical' ? 'var(--remove)' : a.level === 'warning' ? 'var(--review)' : 'var(--brand)'}`,
            }}
          >
            <div className="toolbar">
              <b>{a.title}</b>
              <div className="spacer" />
              <span className="pill">{a.level}</span>
              <span className="muted">{new Date(a.created_at).toLocaleString()}</span>
            </div>
            <div className="muted">{a.body || ''}</div>
            {a.list_id && (
              <button
                className="btn ghost sm"
                style={{ marginTop: 10 }}
                onClick={() => navigate('#/lists/' + a.list_id)}
              >
                View list
              </button>
            )}
          </div>
        ))
      )}
    </>
  );
}
