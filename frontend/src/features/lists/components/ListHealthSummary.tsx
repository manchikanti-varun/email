// List health block: score ring + the four real backend metrics + the
// classification stacked bar. All values come from the backend summary; nothing
// is computed here. Extracted from ListDetailView.
import type { ListSummary } from '../../../types';
import { ScoreRing, MetricBar, StackedBar } from '../../../components/domain';

export function ListHealthSummary({ summary }: { summary: ListSummary }) {
  const m = summary.metrics;
  return (
    <div className="card">
      <h3>List Health</h3>
      <div className="ring-wrap">
        <ScoreRing score={summary.health} label="out of 100" />
        <div style={{ flex: 1 }}>
          <MetricBar label="Confirmed deliverable" value={m.deliverability} color="var(--safe)" />
          <MetricBar label="Catch-all (unconfirmed)" value={m.catchAllAcceptance ?? 0} color="var(--catchall)" />
          <MetricBar label="Could not verify" value={m.unconfirmed ?? 0} color="var(--unknown)" />
          <MetricBar label="Domain infrastructure" value={m.domainHealth} color="var(--brand-2)" />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <StackedBar counts={summary.counts} total={summary.total} />
      </div>
    </div>
  );
}
