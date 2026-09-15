import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { toast } from '../components/Toaster';
import type { Webhook } from '../types';

const PAYLOAD_EXAMPLE = `{
  "event": "job.completed",
  "timestamp": "2026-01-01T00:00:00Z",
  "data": { "listId": "...", "listName": "...", "health": 93.8,
            "counts": { "safe": 39102, "review": 1892, "remove": 733, "unknown": 200 } }
}`;

export function IntegrationsView() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [url, setUrl] = useState('');
  const [event, setEvent] = useState('job.completed');

  const load = useCallback(() => {
    api.webhooks().then(({ webhooks }) => setWebhooks(webhooks)).catch(() => setWebhooks([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const u = url.trim();
    if (!u) return;
    try {
      await api.addWebhook({ url: u, event });
      setUrl('');
      load();
      toast('Webhook added');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add webhook');
    }
  }

  async function del(id: string) {
    await api.deleteWebhook(id);
    load();
  }

  return (
    <>
      <h1 className="page-title">Integrations</h1>
      <p className="page-sub">Send standardized events to Zapier, Make, your CRM, or any endpoint.</p>
      <div className="card" style={{ maxWidth: 760 }}>
        <h3>Webhooks</h3>
        <div className="toolbar">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/..." style={{ flex: 1 }} />
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="job.completed">job.completed</option>
            <option value="health.dropped">health.dropped</option>
            <option value="*">all events</option>
          </select>
          <button className="btn" onClick={add}>Add</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {webhooks == null ? (
            <p className="muted">Loading…</p>
          ) : webhooks.length === 0 ? (
            <p className="muted">No webhooks yet.</p>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className="list-row" style={{ cursor: 'default' }}>
                <div style={{ flex: 1 }}>
                  <b className="email-cell">{w.url}</b>
                  <div className="muted">{w.event}</div>
                </div>
                <button className="btn ghost sm" onClick={() => del(w.id)}>Remove</button>
              </div>
            ))
          )}
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn ghost sm" onClick={async () => { await api.testWebhooks(); toast('Test event sent'); }}>
            Send test event
          </button>
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
