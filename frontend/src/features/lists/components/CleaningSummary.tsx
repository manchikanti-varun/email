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
          <div className="stat-label">Confirmed Safe</div>
          <div className="stat" style={{ color: 'var(--safe)' }}>{summary.counts.safe}</div>
        </div>
        <div>
          <div className="stat-label" title="Catch-all domains: the server accepts arbitrary recipients, so the specific mailbox cannot be independently confirmed.">Review — Catch-All</div>
          <div className="stat" style={{ color: 'var(--review)' }}>{summary.counts.review}</div>
        </div>
        <div>
          <div className="stat-label" title="Inconclusive results (timeout / transport limitation). Not invalid — re-verify later.">Reverify — Unknown</div>
          <div className="stat" style={{ color: 'var(--unknown)' }}>{summary.counts.unknown}</div>
        </div>
        <div>
          <div className="stat-label" title="Definitive negative SMTP evidence.">Remove</div>
          <div className="stat" style={{ color: 'var(--remove)' }}>{summary.counts.remove}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }} className="toolbar">
        <a className="btn sm" href={listsApi.exportUrl(id, 'confirmed')} title="Confirmed deliverable only — excludes catch-all and unknown.">
          Export Confirmed ({summary.counts.safe})
        </a>
        <a className="btn ghost sm" href={listsApi.exportUrl(id, 'catchall')} title="Catch-all addresses only. Mailbox existence is not independently confirmed.">
          Export Catch-All ({summary.counts.review})
        </a>
        <a className="btn ghost sm" href={listsApi.exportUrl(id, 'all')}>All (CSV)</a>
        <a className="btn ghost sm" href={listsApi.exportUrl(id, 'all', 'xlsx')}>All (XLSX)</a>
        <button className="btn danger sm" onClick={() => onPurgeRemove(summary.counts.remove)}>
          Delete all "Remove"
        </button>
      </div>
    </div>
  );
}
