// Thin typed API client (facade).
//
// The generic HTTP concerns (base URL, auth token, headers, JSON parsing,
// HTTP/network errors, 401/429 handling) now live in services/http/client.ts.
// This module keeps the exact same public surface it always had —
//   `api`, `setToken`, `setUnauthorizedHandler`
// — so every existing import continues to work unchanged. It maps the app's
// endpoints onto the shared client. Feature-specific API slices will be layered
// on top of this in later phases; for now the single `api` object is preserved
// verbatim to avoid touching any view.
import type {
  User,
  VerifyResult,
  ListSummaryRow,
  ListDetail,
  UploadResult,
  UploadProgressEvent,
  Progress,
  Alert,
  Webhook,
  CampaignRisk,
  HealthAnalysis,
  DomainsResult,
  HealthPrediction,
  AnomaliesResult,
  Preflight,
  AgentResponse,
  AgentChatPayload,
  VerificationHealth,
  CalibratedConfidence,
} from './types';
import {
  API_BASE,
  request,
  setToken as clientSetToken,
  setUnauthorizedHandler as clientSetUnauthorizedHandler,
  authHeader,
  notifyUnauthorized,
} from './services/http/client';

// Re-export the auth-token + unauthorized-handler controls so existing imports
// (`import { api, setToken, setUnauthorizedHandler } from './api'`) keep working.
export const setToken = clientSetToken;
export const setUnauthorizedHandler = clientSetUnauthorizedHandler;

/** Upload with NDJSON stage events: parsing → saving → done. */
async function uploadListWithProgress(
  formData: FormData,
  onProgress?: (evt: UploadProgressEvent) => void,
): Promise<UploadResult> {
  const headers: Record<string, string> = {
    Accept: 'application/x-ndjson',
    ...authHeader(),
  };

  onProgress?.({ stage: 'uploading' });

  let res: Response;
  try {
    res = await fetch(API_BASE + '/api/lists/upload?progress=1', {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
  } catch {
    throw new Error('Network error — could not reach the server. Check your connection.');
  }

  if (res.status === 401) notifyUnauthorized();
  if (res.status === 429) {
    throw new Error('Too many requests. Please wait a moment and try again.');
  }

  const ct = res.headers.get('content-type') || '';
  // Fallback: non-streaming JSON response (older servers / proxies).
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
    onProgress?.({ stage: 'done', total: data.total });
    return data as UploadResult;
  }

  if (!res.ok && !ct.includes('ndjson')) {
    throw new Error('Upload failed (' + res.status + ')');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Upload failed (no response body)');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: UploadResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(line); } catch { continue; }
      const stage = String(evt.stage || '');
      if (stage === 'parsing' || stage === 'saving') {
        onProgress?.({ stage: stage as UploadProgressEvent['stage'], total: evt.total as number | undefined });
      } else if (stage === 'error') {
        throw new Error(String(evt.error || 'Upload failed'));
      } else if (stage === 'done') {
        const rest = { ...evt };
        delete rest.stage;
        result = rest as unknown as UploadResult;
        onProgress?.({ stage: 'done', total: result.total });
      }
    }
  }

  if (!result) throw new Error('Upload failed (incomplete response)');
  return result;
}

export const api = {
  health: () => request<{ verification?: VerificationHealth }>('GET', '/health'),
  register: (d: { email: string; password: string; name?: string }) =>
    request<{ token: string; user: User; apiKey?: string }>('POST', '/auth/register', d),
  login: (d: { email: string; password: string }) =>
    request<{ token: string; user: User }>('POST', '/auth/login', d),
  logout: () => request('POST', '/auth/logout'),
  me: () => request<{ user: User }>('GET', '/auth/me'),
  rotateKey: () => request<{ apiKey: string; apiKeyPrefix: string }>('POST', '/auth/api-key/rotate'),

  verifySingle: (email: string) =>
    request<{ result: VerifyResult; user: User }>('POST', '/verify/single', { email }),

  uploadList: (
    formData: FormData,
    onProgress?: (evt: UploadProgressEvent) => void,
  ) => uploadListWithProgress(formData, onProgress),
  verifyList: (id: string) => request('POST', `/lists/${id}/verify`),
  listProgress: (id: string) => request<Progress>('GET', `/lists/${id}/progress`),
  lists: () => request<{ lists: ListSummaryRow[] }>('GET', '/lists'),
  listDetail: (id: string) => request<ListDetail>('GET', `/lists/${id}`),
  cleanPlan: (id: string) => request('GET', `/lists/${id}/clean`),
  deleteList: (id: string) => request('DELETE', `/lists/${id}`),
  reverify: (id: string) => request('POST', `/lists/${id}/verify?reverify=true`),
  schedule: (id: string, intervalDays: number, enabled: boolean) =>
    request('POST', `/lists/${id}/schedule`, { intervalDays, enabled }),
  bulkContacts: (id: string, action: string, classification: string) =>
    request<{ deleted: number }>('POST', `/lists/${id}/contacts/bulk`, { action, classification }),
  preflight: (id: string) => request<Preflight>('GET', `/campaigns/${id}/preflight`),
  exportUrl: (id: string, filter: string, format = 'csv') =>
    `${API_BASE}/api/lists/${id}/export?filter=${filter}&format=${format}`,

  // integrations
  webhooks: () => request<{ webhooks: Webhook[] }>('GET', '/integrations/webhooks'),
  addWebhook: (d: { url: string; event: string }) =>
    request('POST', '/integrations/webhooks', d),
  deleteWebhook: (id: string) => request('DELETE', `/integrations/webhooks/${id}`),
  testWebhooks: () => request('POST', '/integrations/webhooks/test'),
  alerts: () => request<{ alerts: Alert[]; unread: number }>('GET', '/integrations/alerts'),
  markAlertsRead: () => request('POST', '/integrations/alerts/read'),

  // MailHealth AI agent
  agentChat: (payload: AgentChatPayload) => request<AgentResponse>('POST', '/agent/chat', payload),
  agentHistory: (conversationId?: string) =>
    request(
      'GET',
      '/agent/history' +
        (conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''),
    ),

  // MailHealth AI Intelligence Layer (deterministic-first analysis)
  aiCampaignRisk: (listId: string) => request<CampaignRisk>('POST', '/ai/campaign-risk', { listId }),
  aiHealthAnalysis: (id: string) => request<HealthAnalysis>('GET', `/ai/lists/${id}/health-analysis`),
  aiHealthPrediction: (id: string) =>
    request<HealthPrediction>('GET', `/ai/lists/${id}/health-prediction`),
  aiAnomalies: (id: string) => request<AnomaliesResult>('GET', `/ai/lists/${id}/anomalies`),
  aiDomains: (id: string) => request<DomainsResult>('GET', `/ai/lists/${id}/domains`),
  aiCleaning: (id: string) => request('GET', `/ai/lists/${id}/cleaning`),
  aiReverificationPriority: (id: string) =>
    request('GET', `/ai/lists/${id}/reverification-priority`),
  aiBusinessInsights: (id: string) => request('GET', `/ai/lists/${id}/business-insights`),
  aiEmailExplanation: (id: string, email: string, mode = 'simple') =>
    request('GET', `/ai/lists/${id}/contacts/${encodeURIComponent(email)}/explanation?mode=${mode}`),
  aiCreditOptimization: (listId: string) =>
    request('GET', `/ai/credits/optimization?listId=${encodeURIComponent(listId)}`),
  aiIncidents: (listId?: string) =>
    request('GET', '/ai/incidents' + (listId ? `?listId=${encodeURIComponent(listId)}` : '')),
  aiInvestigate: (listId: string, question: string) =>
    request('POST', '/ai/investigate', { listId, question }),
  aiBenchmarkAnalysis: (benchmark: unknown) =>
    request('POST', '/ai/benchmark-analysis', { benchmark }),
  aiConfidence: (id: string, email: string) =>
    request<{ confidence: CalibratedConfidence }>(
      'GET',
      `/ai/lists/${id}/contacts/${encodeURIComponent(email)}/confidence`,
    ),
  aiCalibrationStatus: () => request('GET', '/ai/calibration/status'),
  aiCalibrationBenchmark: (dataset: unknown) =>
    request('POST', '/ai/calibration/benchmark', { dataset }),
};
