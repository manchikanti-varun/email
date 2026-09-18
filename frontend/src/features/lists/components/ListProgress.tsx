// Verification-in-progress view for a list. Uses REAL backend progress
// (done/total). Extracted verbatim from ListDetailView's ProgressCard.
import type { Progress } from '../../../types';
import { Progress as ProgressBar } from '../../../components/ui';

export function ListProgress({ name, progress }: { name: string; progress: Progress | null }) {
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <>
      <h1 className="page-title">{name}</h1>
      <div className="card">
        <h3>Verifying…</h3>
        <ProgressBar percent={pct} />
        <p className="muted" style={{ marginTop: 10 }}>
          {progress
            ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} verified (${pct}%)`
            : 'Starting…'}
        </p>
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Diverse domains need live SMTP checks (DNS + mailbox probe). Progress updates as each
          address finishes — the first ones can take a few seconds if mail servers are slow or blocked.
        </p>
      </div>
    </>
  );
}
