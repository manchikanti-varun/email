import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { toast } from '../components/Toaster';

const RESPONSE_EXAMPLE = `{
  "result": {
    "email": "john@company.com",
    "score": 67,
    "classification": "review",
    "status": "risky",
    "signals": [ { "status": "pass", "label": "Valid syntax" }, ... ],
    "reasons": [ "Catch-all domain detected. ..." ],
    "recommendation": "Use with caution. ..."
  },
  "credits": 4999
}`;

export function ApiView() {
  const { user, setUser } = useAuth();
  const origin = (window.__API_BASE__ || location.origin).replace(/\/$/, '');

  // Read the once-only key generated at signup during initial state, so it
  // shows immediately without an extra render pass.
  const [revealedKey, setRevealedKey] = useState<string | null>(() => {
    const freshKey = sessionStorage.getItem('newApiKey');
    if (freshKey) sessionStorage.removeItem('newApiKey');
    return freshKey;
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
    const { apiKey, apiKeyPrefix } = await api.rotateKey();
    setRevealedKey(apiKey);
    if (user) setUser({ ...user, apiKeyPrefix });
    toast('New key revealed — copy it now, it will not be shown again');
  }

  const keyDisplay =
    revealedKey ?? (user?.apiKeyPrefix ? user.apiKeyPrefix + '••••••••••••••••' : 'No key yet');

  const curl = `curl -X POST ${origin}/api/verify/single \\
  -H "X-API-Key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"john@company.com"}'`;

  return (
    <>
      <h1 className="page-title">API</h1>
      <p className="page-sub">Verify emails from your own applications. Standardized results, no provider complexity.</p>
      <div className="card" style={{ maxWidth: 760 }}>
        <h3>Your API key</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          For security, the full key is shown only once when created or rotated. Store it somewhere safe.
        </p>
        <div className="toolbar">
          <code className="key">{keyDisplay}</code>
          <button className="btn ghost sm" onClick={rotate}>Rotate &amp; reveal</button>
        </div>
        <h3 style={{ marginTop: 20 }}>Verify a single email</h3>
        <pre className="reasons" style={{ overflow: 'auto' }}>
          <code>{curl}</code>
        </pre>
        <h3 style={{ marginTop: 20 }}>Response</h3>
        <pre className="reasons" style={{ overflow: 'auto' }}>
          <code>{RESPONSE_EXAMPLE}</code>
        </pre>
      </div>
    </>
  );
}
