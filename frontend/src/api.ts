// Thin typed API client. Uses cookie auth (set by the server) plus a token
// fallback stored in localStorage.
//
// API base URL:
//   - Same origin (local dev with Vite proxy, all-in-one deploy): leave empty,
//     calls go to relative "/api".
//   - Split deploy (frontend on Vercel, backend on Railway): set the backend
//     URL in window.__API_BASE__ via /config.js.
import type {
  User,
  VerifyResult,
  ListSummaryRow,
  ListDetail,
  UploadResult,
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

const API_BASE =
  typeof window !== 'undefined' && window.__API_BASE__
    ? String(window.__API_BASE__).replace(/\/$/, '')
    : '';

let token: string | null = localStorage.getItem('token');

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

// Fired on 401 so the app can redirect to login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

type Method = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';

async function request<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  isForm = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let payload: BodyInit | undefined;
  if (isForm) {
    payload = body as FormData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(API_BASE + '/api' + path, {
      method,
      headers,
      body: payload,
      credentials: 'include',
    });
  } catch {
    throw new Error('Network error — could not reach the server. Check your connection.');
  }

  if (
    res.status === 401 &&
    onUnauthorized &&
    path !== '/auth/me' &&
    path !== '/auth/login' &&
    path !== '/auth/register'
  ) {
    onUnauthorized();
  }
  if (res.status === 429) {
    throw new Error('Too many requests. Please wait a moment and try again.');
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error('Request failed (' + res.status + ')');
    return res as unknown as T;
  }
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data as T;
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

  uploadList: (formData: FormData) => request<UploadResult>('POST', '/lists/upload', formData, true),
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
