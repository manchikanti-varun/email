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
  );
}
