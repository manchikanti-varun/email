// Application header. Intentionally minimal: on mobile it exposes the menu
// toggle for the sidebar drawer and shows the current section label. On desktop
// the sidebar is always visible, so the header stays out of the way.
import { NAV_GROUPS } from './nav-config';

function labelForRoute(route: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.route === route) return item.label;
    }
  }
  // Fallbacks for routes not present as a top-level nav item.
  if (route === 'settings') return 'Settings';
  return 'MailHealth';
}

export function Header({ route, onMenu }: { route: string; onMenu: () => void }) {
  return (
    <header className="app-header">
      <button
        type="button"
        className="menu-toggle"
        aria-label="Open navigation menu"
        onClick={onMenu}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span className="app-header-title">{labelForRoute(route)}</span>
    </header>
  );
}
