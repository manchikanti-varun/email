// Container for the all-lists index. Loads the user's lists, handles delete
// with confirmation, and renders the ListsTable. Extracted from ListsView.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '../../../lib/useHashRoute';
import { PageHeader, LoadingState } from '../../../components/ui';
import type { ListSummaryRow } from '../../../types';
import { listsApi } from '../services/lists-api';
import { ListsTable } from './ListsTable';

export function ListsContainer() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListSummaryRow[] | null>(null);

  const load = useCallback(() => {
    listsApi.all().then(({ lists }) => setLists(lists)).catch(() => setLists([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const del = useCallback(
    async (id: string) => {
      if (!confirm('Delete this list?')) return;
      await listsApi.remove(id);
      load();
    },
    [load],
  );

  return (
    <>
      <PageHeader title="Lists" subtitle="All your uploaded email databases." />
      {lists == null ? (
        <LoadingState />
      ) : (
        <ListsTable lists={lists} onOpen={(id) => navigate('#/lists/' + id)} onDelete={del} />
      )}
    </>
  );
}
