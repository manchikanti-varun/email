// Integrations (webhooks) feature API slice over the shared HTTP client.
// Identical to the original api.webhooks/addWebhook/deleteWebhook/testWebhooks.
import { request } from '../../../services/http/client';
import type { Webhook } from '../../../types';

export const integrationsApi = {
  list: () => request<{ webhooks: Webhook[] }>('GET', '/integrations/webhooks'),
  add: (d: { url: string; event: string }) => request('POST', '/integrations/webhooks', d),
  remove: (id: string) => request('DELETE', `/integrations/webhooks/${id}`),
  test: () => request('POST', '/integrations/webhooks/test'),
};
