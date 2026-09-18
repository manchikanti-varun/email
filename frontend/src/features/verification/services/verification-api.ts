// Verification feature API slice.
//
// Wraps the single-email verification endpoint on top of the shared HTTP client.
// The request is IDENTICAL to the original api.verifySingle():
//   POST /verify/single  { email }  ->  { result: VerifyResult, user: User }
// No endpoint, method, body, auth, or response-shape change. The general `api`
// facade keeps its verifySingle() too, so other callers are unaffected.
import { request } from '../../../services/http/client';
import type { User, VerifyResult } from '../../../types';

export interface VerifySingleResponse {
  result: VerifyResult;
  user: User;
}

export function verifySingleEmail(email: string): Promise<VerifySingleResponse> {
  return request<VerifySingleResponse>('POST', '/verify/single', { email });
}
