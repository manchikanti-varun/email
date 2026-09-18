// Alerts feature API slice over the shared HTTP client. Identical to the
// original api.alerts / api.markAlertsRead.
import { request } from '../../../services/http/client';
import type { Alert } from '../../../types';

export const alertsApi = {
  list: () => request<{ alerts: Alert[]; unread: number }>('GET', '/integrations/alerts'),
  markAllRead: () => request('POST', '/integrations/alerts/read'),
};
