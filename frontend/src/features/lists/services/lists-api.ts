// Lists feature API slice.
//
// Wraps the list-level endpoints on top of the shared HTTP client. Requests are
// identical to the original `api.*` methods (same endpoints/methods/bodies/
// response shapes). The general `api` facade retains these too, so other pages
// are unaffected until they migrate.
import { API_BASE, request } from '../../../services/http/client';
import type {
  ListSummaryRow,
  ListDetail,
  Progress,
  Preflight,
  CampaignRisk,
  HealthAnalysis,
  DomainsResult,
  HealthPrediction,
  AnomaliesResult,
  ListHealthAnalysis,
  LatestListAnalysis,
} from '../../../types';

export const listsApi = {
  all: () => request<{ lists: ListSummaryRow[] }>('GET', '/lists'),
  detail: (id: string) => request<ListDetail>('GET', `/lists/${id}`),
  progress: (id: string) => request<Progress>('GET', `/lists/${id}/progress`),
  verify: (id: string) => request('POST', `/lists/${id}/verify`),
  reverify: (id: string) => request('POST', `/lists/${id}/verify?reverify=true`),
  remove: (id: string) => request('DELETE', `/lists/${id}`),
  schedule: (id: string, intervalDays: number, enabled: boolean) =>
    request('POST', `/lists/${id}/schedule`, { intervalDays, enabled }),
  preflight: (id: string) => request<Preflight>('GET', `/campaigns/${id}/preflight`),

  // Export is a direct download URL (used as an <a href>), not a fetch.
  exportUrl: (id: string, filter: string, format = 'csv') =>
    `${API_BASE}/api/lists/${id}/export?filter=${filter}&format=${format}`,

  // AI insight reads (deterministic-first analysis layer).
  aiCampaignRisk: (id: string) => request<CampaignRisk>('POST', '/ai/campaign-risk', { listId: id }),
  aiHealthAnalysis: (id: string) => request<HealthAnalysis>('GET', `/ai/lists/${id}/health-analysis`),
  aiDomains: (id: string) => request<DomainsResult>('GET', `/ai/lists/${id}/domains`),
  aiHealthPrediction: (id: string) => request<HealthPrediction>('GET', `/ai/lists/${id}/health-prediction`),
  aiAnomalies: (id: string) => request<AnomaliesResult>('GET', `/ai/lists/${id}/anomalies`),

  // AI List Health Analysis & Diagnosis. `analyze` runs the deterministic
  // report + one fail-safe AI diagnosis (AI unavailable → deterministic).
  // `latestAnalysis` returns the persisted result with no LLM call.
  analyze: (id: string, useAi = true) =>
    request<ListHealthAnalysis>('POST', `/ai/lists/${id}/analyze`, { useAi }),
  latestAnalysis: (id: string) =>
    request<LatestListAnalysis>('GET', `/ai/lists/${id}/analysis`),
};
