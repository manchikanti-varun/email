// Workflow-shaped navigation model for the app sidebar.
//
// Grouped by what the user is trying to DO, not by internal module names.
// `route` is the hash-route key (matches useHashRoute's first segment) and is
// used both for navigation (#/<route>) and active-state detection. Only routes
// backed by REAL functionality are listed here.

export interface NavItem {
  /** Hash-route key, e.g. 'single' → #/single. Also used for the NavIcon. */
  route: string;
  label: string;
  /** Icon key for <NavIcon route=…/>. Defaults to `route` when omitted. */
  icon?: string;
}

export interface NavGroup {
  /** Section heading. Empty string renders an ungrouped top item. */
  heading: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: '',
    items: [{ route: 'dashboard', label: 'Dashboard' }],
  },
  {
    heading: 'Verify',
    items: [
      { route: 'single', label: 'Single Check' },
      { route: 'bulk', label: 'Bulk Verification' },
    ],
  },
  {
    heading: 'Lists',
    items: [{ route: 'lists', label: 'All Lists' }],
  },
  {
    heading: 'Health',
    items: [{ route: 'alerts', label: 'Health & Alerts' }],
  },
  {
    heading: 'AI',
    items: [{ route: 'agent', label: 'MailHealth AI' }],
  },
  {
    heading: 'Tools',
    items: [
      { route: 'integrations', label: 'Integrations' },
      { route: 'api', label: 'API' },
    ],
  },
  {
    heading: 'Settings',
    items: [{ route: 'settings', label: 'Settings' }],
  },
];
