import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useNavigate } from '../lib/useHashRoute';
import { SkeletonRows } from '../components/ui';
import { scoreColor, statusLabel } from '../lib/format';
import type { ListSummaryRow } from '../types';

export function ListsView() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListSummaryRow[] | null>(null);

  const load = useCallback(() => {
    api.lists().then(({ lists }) => setLists(lists)).catch(() => setLists([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function del(id: string) {
    if (!confirm('Delete this list?')) return;
    await api.deleteList(id);
    load();
  }

  return (
    <>
      <h1 className="page-title">Lists</h1>
      <p className="page-sub">All your uploaded email databases.</p>

      {lists == null ? (
        <SkeletonRows />
      ) : lists.length === 0 ? (
        <div className="empty">No lists yet. Upload one from the Dashboard.</div>
      ) : (
        lists.map((l) => (
          <div key={l.id} className="list-row" onClick={() => navigate('#/lists/' + l.id)}>
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
              onClick={(e) => {
                e.stopPropagation();
                del(l.id);
              }}
            >
              Delete
            </button>
          </div>
        ))
      )}
    </>
  );
}
