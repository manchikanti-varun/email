import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useNavigate } from '../lib/useHashRoute';
import { NavIcon } from './ui';

const NAV: [string, string][] = [
  ['dashboard', 'Dashboard'],
  ['lists', 'Lists'],
  ['agent', 'MailHealth AI'],
  ['single', 'Single Check'],
  ['alerts', 'Alerts'],
  ['integrations', 'Integrations'],
  ['api', 'API'],
];

// Honest banner about verification accuracy in the current environment.
function VerificationBanner() {
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

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api.alerts().then(({ unread }) => setUnread(unread)).catch(() => {});
  }, [route]);

  if (!user) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Mail<span>Health</span>
        </div>
        <nav className="nav">
          {NAV.map(([r, label]) => (
            <a
              key={r}
              className={route === r ? 'active' : ''}
              onClick={() => navigate('#/' + r)}
              style={{ cursor: 'pointer' }}
            >
              <NavIcon route={r} />
              <span>{r === 'alerts' && unread > 0 ? `${label} (${unread})` : label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="credits-badge">
            Credits
            <br />
            <b id="credits">{user.credits.toLocaleString()}</b>
          </div>
          <div style={{ marginTop: 10 }} className="muted">
            {user.email}
          </div>
          <button className="btn ghost sm" onClick={logout} style={{ marginTop: 10, width: '100%' }}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <VerificationBanner />
        {children}
      </main>
    </div>
  );
}
