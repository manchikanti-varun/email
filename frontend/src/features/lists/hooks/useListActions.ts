// List-level actions: reverify, bulk delete-by-classification ("purge remove"),
// schedule, and delete. Confirmation prompts and toasts are preserved verbatim
// from the original ListDetailView. Each action reports back via callbacks so
// the container can reload / navigate as before.
import { useCallback } from 'react';
import { toast } from '../../../components/ui/Toast';
import { listsApi } from '../services/lists-api';
import { contactsApi } from '../services/contacts-api';

export function useListActions(
  id: string,
  { onReverifyStarted, onReload }: { onReverifyStarted: () => void; onReload: () => void },
) {
  const reverify = useCallback(async () => {
    if (!confirm('Re-verify all contacts? This recharges credits for the whole list.')) return;
    try {
      await listsApi.reverify(id);
      toast('Re-verification started');
      onReverifyStarted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start');
    }
  }, [id, onReverifyStarted]);

  const purgeRemove = useCallback(
    async (count: number) => {
      if (!confirm(`Permanently delete ${count} "Remove" contacts?`)) return;
      const r = await contactsApi.bulk(id, 'delete-by-classification', 'remove');
      toast(`Deleted ${r.deleted} contacts`);
      onReload();
    },
    [id, onReload],
  );

  const schedule = useCallback(
    async (days: number) => {
      await listsApi.schedule(id, days, true);
      toast(`Scheduled every ${days} day(s)`);
    },
    [id],
  );

  return { reverify, purgeRemove, schedule };
}
