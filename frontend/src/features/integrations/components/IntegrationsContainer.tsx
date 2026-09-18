// Integrations: webhook management (add / list / delete / test) + a static
// payload example. Extracted from IntegrationsView; behavior preserved.
import { useState } from 'react';
import { PageHeader, LoadingState, EmptyState } from '../../../components/ui';
import { useWebhooks } from '../hooks/useWebhooks';

const PAYLOAD_EXAMPLE = `{
  "event": "job.completed",
  "timestamp": "2026-01-01T00:00:00Z",
  "data": { "listId": "...", "listName": "...", "health": 93.8,
            "counts": { "safe": 39102, "review": 1892, "remove": 733, "unknown": 200 } }
}`;

export function IntegrationsContainer() {
  const { webhooks, add, remove, sendTest } = useWebhooks();
  const [url, setUrl] = useState('');
  const [event, setEvent] = useState('job.completed');

  async function submit() {
    const ok = await add(url, event);
    if (ok) setUrl('');
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Send standardized events to Zapier, Make, your CRM, or any endpoint."
      />
      <div className="card" style={{ maxWidth: 760 }}>
        <h3>Webhooks</h3>
        <div className="toolbar">
          <label className="visually-hidden" htmlFor="webhook-url">Webhook URL</label>
          <input
            id="webhook-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/..."
            style={{ flex: 1 }}
          />
          <label className="visually-hidden" htmlFor="webhook-event">Event</label>
          <select id="webhook-event" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="job.completed">job.completed</option>
            <option value="health.dropped">health.dropped</option>
            <option value="*">all events</option>
          </select>
          <button className="btn" onClick={submit}>Add</button>
        </div>

        <div style={{ marginTop: 12 }}>
          {webhooks == null ? (
            <LoadingState />
          ) : webhooks.length === 0 ? (
            <EmptyState title="No webhooks yet.">Add one above to receive list health events at your endpoint.</EmptyState>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className="list-row" style={{ cursor: 'default' }}>
                <div style={{ flex: 1 }}>
                  <b className="email-cell">{w.url}</b>
                  <div className="muted">{w.event}</div>
                </div>
                <button className="btn ghost sm" aria-label={`Remove webhook ${w.url}`} onClick={() => remove(w.id)}>
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn ghost sm" onClick={sendTest}>Send test event</button>
        </div>

        <h3 style={{ marginTop: 20 }}>Payload</h3>
        <pre className="reasons" style={{ overflow: 'auto' }}>
          <code>{PAYLOAD_EXAMPLE}</code>
        </pre>
        <p className="muted">
          A per-webhook secret (optional) signs each payload with HMAC-SHA256 in the{' '}
          <code>X-MailHealth-Signature</code> header.
        </p>
      </div>
    </>
  );
}
