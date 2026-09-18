// API-key feature service over the shared HTTP client. Identical to
// api.rotateKey. Rotating returns the new key ONCE (shown, never re-fetched).
import { request } from '../../../services/http/client';

export const apiKeyApi = {
  rotate: () => request<{ apiKey: string; apiKeyPrefix: string }>('POST', '/auth/api-key/rotate'),
};
