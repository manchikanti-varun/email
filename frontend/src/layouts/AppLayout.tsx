// Application chrome: sidebar + header + verification banner + main content.
//
// Relocated and recomposed from the original components/Shell.tsx (Phase 1B).
// Behavior preserved:
//   - hides itself until a user is present (auth gate handled by App)
//   - fetches the unread alerts count on each route change (badge)
//   - renders the honest verification-accuracy banner above page content
//
// New: responsive sidebar. On desktop the sidebar is always visible; on small
// screens it becomes a slide-in drawer toggled from the header, with a backdrop.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { VerificationBanner } from './VerificationBanner';

export function AppLayout({ route, children }: { route: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    api.alerts().then(({ unread }) => setUnread(unread)).catch(() => {});
  }, [route]);

  if (!user) return null;

  return (
    <div className={`shell ${drawerOpen ? 'drawer-open' : ''}`.trim()}>
      <Sidebar
        route={route}
        user={user}
        unread={unread}
        open={drawerOpen}
        onLogout={logout}
        onNavigate={() => setDrawerOpen(false)}
      />
      {/* Mobile backdrop: tap outside the drawer to close it. */}
      <div
        className="sidebar-backdrop"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <main className="main">
        <Header route={route} onMenu={() => setDrawerOpen(true)} />
        <VerificationBanner />
        {children}
      </main>
    </div>
  );
}
