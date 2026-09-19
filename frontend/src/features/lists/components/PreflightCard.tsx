// Campaign preflight card. Fetches its own data (as in the original) and hides
// itself on failure. Extracted from ListDetailView.
import { useEffect, useState } from 'react';
import type { Preflight } from '../../../types';
import { listsApi } from '../services/lists-api';

export function PreflightCard({ id }: { id: string }) {
  const [p, setP] = useState<Preflight | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listsApi.preflight(id).then(setP).catch(() => setFailed(true));
  }, [id]);

  if (failed) return null;

  const bar = (label: string, n: number, color: string) => (
    <div className="signal" key={label}>
      <span className="dot" style={{ background: color }} />
      {n.toLocaleString()} — {label}
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {!p ? (
        <>
          <h3>Campaign Preflight</h3>
          <p className="muted">Loading…</p>
        </>
      ) : (
        <>
          <div className="toolbar">
            <h3 style={{ margin: 0 }}>Campaign Preflight</h3>
            <div className="spacer" />
            <span className="pill">{p.recipients.toLocaleString()} recipients</span>
          </div>
          <div className="grid cols-2">
            <div>
              {bar('Confirmed', p.buckets.confirmed, 'var(--safe)')}
              {bar('Review — Catch-All', p.buckets.catchAll, 'var(--catchall)')}
              {bar('Unconfirmed — Unknown', p.buckets.unknown, 'var(--unknown)')}
              {bar('Blocked — Undeliverable', p.buckets.blocked, 'var(--remove)')}
            </div>
            <div>
              <div className="stat-label" title="Confirmed mailbox-level deliverable recipients only. Catch-all and unknown are NOT included — their mailbox existence is not independently confirmed.">
                Recommended send list (confirmed)
              </div>
              <div className="stat" style={{ color: 'var(--safe)' }}>{p.recommendedSendList.toLocaleString()}</div>
              <div className="recommendation" style={{ marginTop: 12 }}>
                <b>Can I safely send this campaign?</b>
                <br />
                {p.verdict}
              </div>
              <a className="btn sm" style={{ marginTop: 12 }} href={listsApi.exportUrl(id, 'confirmed')}>
                Download confirmed send list
              </a>
              {p.buckets.catchAll > 0 && (
                <a className="btn ghost sm" style={{ marginTop: 8 }} href={listsApi.exportUrl(id, 'catchall')}>
                  Export catch-all separately
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
