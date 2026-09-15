// Thin API client. Uses cookie auth (set by the server) plus a token fallback.
//
// API base URL:
//   - When frontend + backend are the same origin (local dev, all-in-one
//     deploy), leave it empty and calls go to the relative "/api".
//   - When split (frontend on Vercel, backend on Railway), set the backend URL
//     in window.__API_BASE__ via /config.js (see public/config.js).
const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__)
  ? String(window.__API_BASE__).replace(/\/$/, '')
  : '';

let token = localStorage.getItem('token') || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

// Fired on 401 so the app can redirect to login.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body, isForm = false) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let payload;
  if (isForm) {
    payload = body; // FormData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, { method, headers, body: payload, credentials: 'include' });
  } catch {
    // Network failure / server unreachable.
    throw new Error('Network error — could not reach the server. Check your connection.');
  }

  if (res.status === 401 && onUnauthorized && path !== '/auth/me' &&
      path !== '/auth/login' && path !== '/auth/register') {
    onUnauthorized();
  }
  if (res.status === 429) {
    throw new Error('Too many requests. Please wait a moment and try again.');
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error('Request failed (' + res.status + ')');
    return res;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  register: (d) => request('POST', '/auth/register', d),
  login: (d) => request('POST', '/auth/login', d),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  rotateKey: () => request('POST', '/auth/api-key/rotate'),

  verifySingle: (email) => request('POST', '/verify/single', { email }),

  uploadList: (formData) => request('POST', '/lists/upload', formData, true),
  verifyList: (id) => request('POST', `/lists/${id}/verify`),
  listProgress: (id) => request('GET', `/lists/${id}/progress`),
  lists: () => request('GET', '/lists'),
  listDetail: (id) => request('GET', `/lists/${id}`),
  cleanPlan: (id) => request('GET', `/lists/${id}/clean`),
  deleteList: (id) => request('DELETE', `/lists/${id}`),
  reverify: (id) => request('POST', `/lists/${id}/verify?reverify=true`),
  schedule: (id, intervalDays, enabled) => request('POST', `/lists/${id}/schedule`, { intervalDays, enabled }),
  bulkContacts: (id, action, classification) => request('POST', `/lists/${id}/contacts/bulk`, { action, classification }),
  preflight: (id) => request('GET', `/campaigns/${id}/preflight`),
  exportUrl: (id, filter, format = 'csv') => `${API_BASE}/api/lists/${id}/export?filter=${filter}&format=${format}`,

  // integrations
  webhooks: () => request('GET', '/integrations/webhooks'),
  addWebhook: (d) => request('POST', '/integrations/webhooks', d),
  deleteWebhook: (id) => request('DELETE', `/integrations/webhooks/${id}`),
  testWebhooks: () => request('POST', '/integrations/webhooks/test'),
  alerts: () => request('GET', '/integrations/alerts'),
  markAlertsRead: () => request('POST', '/integrations/alerts/read'),

  // MailHealth AI agent
  agentChat: (payload) => request('POST', '/agent/chat', payload),
  agentHistory: (conversationId) =>
    request('GET', '/agent/history' + (conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '')),

  // MailHealth AI Intelligence Layer (deterministic-first analysis)
  aiCampaignRisk: (listId) => request('POST', '/ai/campaign-risk', { listId }),
  aiHealthAnalysis: (id) => request('GET', `/ai/lists/${id}/health-analysis`),
  aiHealthPrediction: (id) => request('GET', `/ai/lists/${id}/health-prediction`),
  aiAnomalies: (id) => request('GET', `/ai/lists/${id}/anomalies`),
  aiDomains: (id) => request('GET', `/ai/lists/${id}/domains`),
  aiCleaning: (id) => request('GET', `/ai/lists/${id}/cleaning`),
  aiReverificationPriority: (id) => request('GET', `/ai/lists/${id}/reverification-priority`),
  aiBusinessInsights: (id) => request('GET', `/ai/lists/${id}/business-insights`),
  aiEmailExplanation: (id, email, mode = 'simple') =>
    request('GET', `/ai/lists/${id}/contacts/${encodeURIComponent(email)}/explanation?mode=${mode}`),
  aiCreditOptimization: (listId) => request('GET', `/ai/credits/optimization?listId=${encodeURIComponent(listId)}`),
  aiIncidents: (listId) => request('GET', '/ai/incidents' + (listId ? `?listId=${encodeURIComponent(listId)}` : '')),
  aiInvestigate: (listId, question) => request('POST', '/ai/investigate', { listId, question }),
  aiBenchmarkAnalysis: (benchmark) => request('POST', '/ai/benchmark-analysis', { benchmark }),
  // ML Confidence Calibration (additive).
  aiConfidence: (id, email) =>
    request('GET', `/ai/lists/${id}/contacts/${encodeURIComponent(email)}/confidence`),
  aiCalibrationStatus: () => request('GET', '/ai/calibration/status'),
  aiCalibrationBenchmark: (dataset) => request('POST', '/ai/calibration/benchmark', { dataset }),
};
