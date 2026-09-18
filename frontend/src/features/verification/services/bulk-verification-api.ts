// Bulk verification feature API slice.
//
// Owns the endpoints used by the bulk upload → verify workflow, built on the
// shared HTTP client. The NDJSON streaming upload is preserved VERBATIM from the
// original api.uploadList() (stage events: uploading → parsing → saving → done,
// with a JSON fallback for older servers/proxies). No endpoint/method/body or
// response-shape change. The general `api` facade keeps these too.
import {
  API_BASE,
  request,
  authHeader,
  notifyUnauthorized,
} from '../../../services/http/client';
import type { UploadProgressEvent, UploadResult, ListSummaryRow } from '../../../types';

export const bulkVerificationApi = {
  // Overview data used by the dashboard (kept here since the bulk panel + the
  // dashboard both read the user's lists).
  lists: () => request<{ lists: ListSummaryRow[] }>('GET', '/lists'),

  // Start verification for an uploaded list.
  startVerification: (listId: string) => request('POST', `/lists/${listId}/verify`),

  // Streaming upload with NDJSON stage events (identical to api.uploadList).
  upload: uploadListWithProgress,
};

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
