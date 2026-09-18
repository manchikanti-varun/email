// Webhooks state: load list, add (with url+event), delete, send test. Mirrors
// the original IntegrationsView behavior including toasts.
import { useCallback, useEffect, useState } from 'react';
import { toast } from '../../../components/ui/Toast';
import type { Webhook } from '../../../types';
import { integrationsApi } from '../services/integrations-api';

export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);

  const load = useCallback(() => {
    integrationsApi.list().then(({ webhooks }) => setWebhooks(webhooks)).catch(() => setWebhooks([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (url: string, event: string) => {
      const u = url.trim();
      if (!u) return false;
      try {
        await integrationsApi.add({ url: u, event });
        load();
        toast('Webhook added');
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not add webhook');
        return false;
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await integrationsApi.remove(id);
      load();
    },
    [load],
  );

  const sendTest = useCallback(async () => {
    await integrationsApi.test();
    toast('Test event sent');
  }, []);

  return { webhooks, add, remove, sendTest };
}
