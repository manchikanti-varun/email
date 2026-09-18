// State + behavior for the single-email verification experience.
//
// Owns: input value, client-side validation, loading, the API/network error
// (kept separate from a verification UNKNOWN result — those are different), the
// result, and reset. It calls the feature API service and reports the updated
// user back to the caller so credits stay in sync (preserving the original
// SingleCheckView behavior).
import { useCallback, useState } from 'react';
import type { User, VerifyResult } from '../../../types';
import { verifySingleEmail } from '../services/verification-api';

// Same permissive shape the backend enforces; used ONLY to give the user a
// friendly client-side message before spending a credit. The backend remains
// the source of truth for validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UseSingleVerification {
  email: string;
  setEmail: (v: string) => void;
  busy: boolean;
  result: VerifyResult | null;
  /** Client-side validation message (invalid input before any request). */
  validationError: string;
  /** API / network failure message (distinct from a verification UNKNOWN). */
  requestError: string;
  run: () => Promise<void>;
  reset: () => void;
}

export function useSingleVerification(onUser?: (u: User) => void): UseSingleVerification {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [validationError, setValidationError] = useState('');
  const [requestError, setRequestError] = useState('');

  const run = useCallback(async () => {
    const value = email.trim();
    setValidationError('');
    setRequestError('');

    if (!value) {
      setValidationError('Enter an email address to verify.');
      return;
    }
    if (value.length > 254 || !EMAIL_RE.test(value)) {
      setValidationError('Enter a valid email address (e.g. name@company.com).');
      return;
    }

    setResult(null);
    setBusy(true);
    try {
      const { result: r, user } = await verifySingleEmail(value);
      setResult(r);
      if (user && onUser) onUser(user);
    } catch (e) {
      setRequestError(
        e instanceof Error ? e.message : "We couldn't reach MailHealth. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [email, onUser]);

  const reset = useCallback(() => {
    setResult(null);
    setValidationError('');
    setRequestError('');
    setEmail('');
  }, []);

  return { email, setEmail, busy, result, validationError, requestError, run, reset };
}
