// A single alert card: severity-colored left border, title, level pill, time,
// body, and an optional "View list" navigation. Extracted from AlertsView.
import type { Alert } from '../../../types';
import { useNavigate } from '../../../lib/useHashRoute';

const LEVEL_COLOR: Record<string, string> = {
  critical: 'var(--remove)',
  warning: 'var(--review)',
  info: 'var(--brand)',
};

export function AlertItem({ alert }: { alert: Alert }) {
  const navigate = useNavigate();
  return (
    <div
      className="card"
      style={{
        marginBottom: 10,
        borderLeft: `3px solid ${LEVEL_COLOR[alert.level] || 'var(--brand)'}`,
      }}
    >
      <div className="toolbar">
        <b>{alert.title}</b>
        <div className="spacer" />
        <span className="pill">{alert.level}</span>
        <span className="muted">{new Date(alert.created_at).toLocaleString()}</span>
      </div>
      <div className="muted">{alert.body || ''}</div>
      {alert.list_id && (
        <button
          className="btn ghost sm"
          style={{ marginTop: 10 }}
          onClick={() => navigate('#/lists/' + alert.list_id)}
        >
          View list
        </button>
      )}
    </div>
  );
}
