// Dashboard overview: high-level stats derived from the user's lists + credits.
// Values are computed from real backend list summaries (lists count, total
// contacts, average health across verified lists) — no fabricated metrics.
// Extracted from DashboardView.
import type { ListSummaryRow, User } from '../../../types';
import { StatCard } from '../../../components/ui';
import { scoreColor } from '../../../lib/format';

export function DashboardOverview({
  lists,
  user,
}: {
  lists: ListSummaryRow[];
  user: User | null;
}) {
  const verified = lists.filter((l) => l.health != null);
  const avg = verified.length
    ? Math.round((verified.reduce((s, l) => s + (l.health || 0), 0) / verified.length) * 10) / 10
    : 0;
  const totalContacts = lists.reduce((s, l) => s + l.total, 0);

  return (
    <div className="grid cols-4" style={{ marginBottom: 24 }}>
      <StatCard label="Lists" value={lists.length} />
      <StatCard label="Contacts" value={totalContacts.toLocaleString()} />
      <StatCard label="Avg. Health" value={avg || '—'} color={scoreColor(avg)} />
      <StatCard label="Credits" value={user?.credits.toLocaleString() ?? '—'} />
    </div>
  );
}
