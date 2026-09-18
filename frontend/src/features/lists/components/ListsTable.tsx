// The all-lists index: each row shows the list's health score, name, contact
// count, status and date, with a delete action. Row click opens the list.
// Extracted from ListsView; presentation only (data + delete handler injected).
import type { ListSummaryRow } from '../../../types';
import { EmptyState } from '../../../components/ui';
import { scoreColor, statusLabel } from '../../../lib/format';

export function ListsTable({
  lists,
  onOpen,
  onDelete,
}: {
  lists: ListSummaryRow[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (lists.length === 0) {
    return <EmptyState title="No lists yet.">Upload one from the Dashboard.</EmptyState>;
  }

  return (
    <>
      {lists.map((l) => (
        <div
          key={l.id}
          className="list-row"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(l.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(l.id);
            }
          }}
        >
          <div className="mini-score" style={{ color: l.health != null ? scoreColor(l.health) : 'var(--muted)' }}>
            {l.health != null ? l.health : '—'}
          </div>
          <div style={{ flex: 1 }}>
            <div>
              <b>{l.name}</b>
            </div>
            <div className="muted">
              {l.total.toLocaleString()} contacts · {statusLabel(l.status)} ·{' '}
              {new Date(l.created_at).toLocaleDateString()}
            </div>
          </div>
          <button
            className="btn ghost sm"
            aria-label={`Delete list ${l.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(l.id);
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </>
  );
}
