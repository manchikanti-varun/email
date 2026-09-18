// API-key state: reads the once-only key generated at signup (from
// sessionStorage, consumed on first render) and supports rotate-and-reveal.
// Behavior mirrors the original ApiView, including the "shown only once"
// security semantics. The key is never logged.
import { useEffect, useState } from 'react';
import { useAuth } from '../../../auth';
import { SIGNUP_API_KEY_STORAGE } from '../../../app/providers/AuthProvider';
import { toast } from '../../../components/ui/Toast';
import { apiKeyApi } from '../services/api-key-api';

export function useApiKey() {
  const { user, setUser } = useAuth();

  // Consume the freshly-revealed signup key during initial state so it shows
  // immediately without an extra render pass (same as the original).
  const [revealedKey, setRevealedKey] = useState<string | null>(() => {
    const fresh = sessionStorage.getItem(SIGNUP_API_KEY_STORAGE);
    if (fresh) sessionStorage.removeItem(SIGNUP_API_KEY_STORAGE);
    return fresh;
  });

  useEffect(() => {
    if (revealedKey) {
      toast('This is your API key — copy it now, it will not be shown again');
    }
    // Run once on mount for the freshly-revealed key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rotate() {
    if (!confirm('Rotate API key? The old key stops working immediately.')) return;
    const { apiKey, apiKeyPrefix } = await apiKeyApi.rotate();
    setRevealedKey(apiKey);
    if (user) setUser({ ...user, apiKeyPrefix });
    toast('New key revealed — copy it now, it will not be shown again');
  }

  const keyDisplay =
    revealedKey ?? (user?.apiKeyPrefix ? user.apiKeyPrefix + '••••••••••••••••' : 'No key yet');

  return { keyDisplay, rotate };
}
