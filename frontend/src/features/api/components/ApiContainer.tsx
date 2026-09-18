// API screen: shows the API key (revealed once), rotate action, and static
// usage docs (curl + response). Extracted from ApiView; behavior preserved.
// The full key is only shown on create/rotate; otherwise a masked prefix.
import { PageHeader } from '../../../components/ui';
import { API_BASE } from '../../../services/http/client';
import { useApiKey } from '../hooks/useApiKey';

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

export function ApiContainer() {
  const { keyDisplay, rotate } = useApiKey();
  const origin = (window.__API_BASE__ || API_BASE || location.origin).replace(/\/$/, '');

  const curl = `curl -X POST ${origin}/api/verify/single \\
  -H "X-API-Key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"john@company.com"}'`;

  return (
    <>
      <PageHeader
        title="API"
        subtitle="Verify emails from your own applications. Standardized results, no provider complexity."
      />
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
