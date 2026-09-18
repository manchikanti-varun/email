// Central frontend HTTP client.
//
// This is the ONE place that knows about: the API base URL, the auth token,
// request headers, JSON parsing, and HTTP/network error normalization. Feature
// services build on top of it; React components never call fetch() directly.
//
// It is extracted verbatim (behavior-preserving) from the original src/api.ts:
//   - same base-URL resolution (window.__API_BASE__ or same-origin)
//   - same token storage (localStorage 'token') + Bearer header
//   - same credentials:'include' cookie auth
//   - same 401 -> onUnauthorized() (with the same path exclusions)
//   - same 429 -> "Too many requests" message
//   - same non-JSON handling and error message shape
//
// The only additions are typed ApiError metadata (status/code), which are
// additive and optional — existing `e.message` consumers are unaffected.
import { ApiError } from './errors';

export const API_BASE =
  typeof window !== 'undefined' && window.__API_BASE__
    ? String(window.__API_BASE__).replace(/\/$/, '')
    : '';

let token: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

export function getToken(): string | null {
  return token;
}

// Fired on 401 so the app can redirect to login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export type Method = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';

// Paths where a 401 must NOT trigger the global unauthorized handler
// (they represent the auth flow itself).
const AUTH_FLOW_PATHS = new Set(['/auth/me', '/auth/login', '/auth/register']);

export async function request<T = unknown>(
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
    throw new ApiError(
      'Network error — could not reach the server. Check your connection.',
      { code: 'NETWORK' },
    );
  }

  if (res.status === 401 && onUnauthorized && !AUTH_FLOW_PATHS.has(path)) {
    onUnauthorized();
  }
  if (res.status === 429) {
    throw new ApiError('Too many requests. Please wait a moment and try again.', {
      status: 429,
      code: 'RATE_LIMITED',
    });
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) {
      throw new ApiError('Request failed (' + res.status + ')', {
        status: res.status,
        code: 'HTTP',
      });
    }
    return res as unknown as T;
  }
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError((data && data.error) || 'Request failed', {
      status: res.status,
      code: res.status === 401 ? 'UNAUTHORIZED' : 'HTTP',
    });
  }
  return data as T;
}

// Low-level access to the resolved auth header + base URL for streaming
// requests (e.g. the NDJSON upload) that cannot use request() directly.
export function authHeader(): Record<string, string> {
  return token ? { Authorization: 'Bearer ' + token } : {};
}

export function notifyUnauthorized(): void {
  onUnauthorized?.();
}
