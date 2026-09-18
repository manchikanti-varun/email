// Historical monitoring: real health line chart + a per-check delta table.
// Renders only when the backend returned more than one history point (the
// container guards this), so no trend is ever fabricated. Extracted from
// ListDetailView's HistoryCard.
import type { HistoryPoint } from '../../../types';
import { LineChart } from '../../../components/domain';
import { scoreColor } from '../../../lib/format';

export function HealthTrend({ history }: { history: HistoryPoint[] }) {
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
