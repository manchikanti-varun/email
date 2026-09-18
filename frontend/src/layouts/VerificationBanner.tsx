// Honest banner about verification accuracy in the current environment.
// Extracted verbatim from the original Shell.tsx (Phase 1B). Behavior unchanged:
// it shows only when the backend reports a non-live verification mode.
import { useEffect, useState } from 'react';
import { api } from '../api';

export function VerificationBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    api
      .health()
      .then(({ verification: v }) => {
        if (!v || v.mode === 'live-smtp' || v.mode === 'smtp-worker' || v.mode === 'external-provider') return;
        setShow(true);
      })
      .catch(() => {});
  }, []);
  if (!show) return null;
  return (
    <div className="banner-warn">
      <div>
        <b>Limited accuracy in this environment.</b> Live mailbox verification (SMTP) isn't available here, so
        addresses that pass syntax/DNS/MX are reported as <b>Unknown</b> rather than Safe — we don't guess. For real
        mailbox-level results, run on a host with outbound port 25 open (set <code>SMTP_ENABLED=true</code>) or configure
        a verification provider.
      </div>
    </div>
  );
}
