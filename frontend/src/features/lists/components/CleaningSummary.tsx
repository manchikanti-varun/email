// Cleaning summary: keep/review/remove/unknown counts + export links + the
// destructive "delete all Remove" action. Export uses direct download URLs.
// Extracted from ListDetailView.
import type { ListSummary } from '../../../types';
import { listsApi } from '../services/lists-api';

export function CleaningSummary({
  id,
  summary,
  onPurgeRemove,
}: {
  id: string;
  summary: ListSummary;
  onPurgeRemove: (count: number) => void;
}) {
  return (
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
        <a className="btn sm" href={listsApi.exportUrl(id, 'campaign')}>Export Safe (CSV)</a>
        <a className="btn ghost sm" href={listsApi.exportUrl(id, 'all')}>All (CSV)</a>
        <a className="btn ghost sm" href={listsApi.exportUrl(id, 'all', 'xlsx')}>All (XLSX)</a>
        <button className="btn danger sm" onClick={() => onPurgeRemove(summary.counts.remove)}>
          Delete all "Remove"
        </button>
      </div>
    </div>
  );
}
