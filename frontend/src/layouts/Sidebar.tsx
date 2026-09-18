// Application sidebar navigation.
//
// Renders the workflow-grouped NAV_GROUPS with meaningful icons + labels, a
// clear active state, keyboard-accessible controls, and (on mobile) a slide-in
// drawer controlled by `open`/`onNavigate`. Presentation + navigation only;
// account/credits chrome lives in the sidebar footer, unchanged from Shell.
import type { User } from '../types';
import { useNavigate } from '../lib/useHashRoute';
import { NavIcon } from '../components/ui/NavIcon';
import { NAV_GROUPS } from './nav-config';

export function Sidebar({
  route,
  user,
  unread,
  open,
  onLogout,
  onNavigate,
}: {
  route: string;
  user: User;
  unread: number;
  open: boolean;
  onLogout: () => void;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();

  function go(r: string) {
    navigate('#/' + r);
    onNavigate(); // close the mobile drawer after selection
  }

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`.trim()} aria-label="Primary">
      <div className="brand">
        Mail<span>Health</span>
      </div>

      <nav className="nav">
        {NAV_GROUPS.map((group, gi) => (
          <div className="nav-group" key={group.heading || `top-${gi}`}>
            {group.heading && <div className="nav-heading">{group.heading}</div>}
            {group.items.map((item) => {
              const active = route === item.route;
              return (
                <button
                  key={item.route}
                  type="button"
                  className={`nav-link ${active ? 'active' : ''}`.trim()}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => go(item.route)}
                >
                  <NavIcon route={item.icon || item.route} />
                  <span>
                    {item.route === 'alerts' && unread > 0 ? `${item.label} (${unread})` : item.label}
                  </span>
                </button>
              );
            })}
          </div>
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
        <button className="btn ghost sm" onClick={onLogout} style={{ marginTop: 10, width: '100%' }}>
          Log out
        </button>
      </div>
    </aside>
  );
}
