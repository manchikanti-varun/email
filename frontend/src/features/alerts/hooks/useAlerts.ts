// Alerts list state: fetch-once on mount + mark-all-read (which reloads).
// Mirrors the original AlertsView behavior (no polling existed there).
import { useCallback, useEffect, useState } from 'react';
import type { Alert } from '../../../types';
import { alertsApi } from '../services/alerts-api';

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  const load = useCallback(() => {
    alertsApi.list().then(({ alerts }) => setAlerts(alerts)).catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = useCallback(async () => {
    await alertsApi.markAllRead();
    load();
  }, [load]);

  return { alerts, markRead };
}
