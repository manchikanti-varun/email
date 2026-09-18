// Application root: maps the current hash route to a page, inside the app shell.
//
// This stays intentionally thin — it contains NO feature logic. The hash router
// (lib/useHashRoute) and every existing route/deep link are preserved:
//   #/dashboard  #/single  #/bulk  #/lists  #/lists/:id  #/agent  #/agent/:id
//   #/alerts  #/integrations  #/api  #/settings
// Unknown routes fall back to the dashboard, matching prior behavior.
import { useAuth } from '../auth';
import { useHashRoute } from '../lib/useHashRoute';
import { AppLayout } from '../layouts/AppLayout';
import { AuthPage } from '../pages/AuthPage';

import { DashboardPage } from '../pages/DashboardPage';
import { ListsPage } from '../pages/ListsPage';
import { ListDetailPage } from '../pages/ListDetailPage';
import { SingleCheckPage } from '../pages/SingleCheckPage';
import { BulkVerificationPage } from '../pages/BulkVerificationPage';
import { AlertsPage } from '../pages/AlertsPage';
import { IntegrationsPage } from '../pages/IntegrationsPage';
import { ApiPage } from '../pages/ApiPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AgentPage } from '../pages/AgentPage';

export function App() {
  const { user, loading } = useAuth();
  const { route, param } = useHashRoute();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  let page;
  switch (route) {
    case 'lists':
      page = param ? <ListDetailPage key={param} id={param} /> : <ListsPage />;
      break;
    case 'agent':
      page = <AgentPage listId={param} />;
      break;
    case 'single':
      page = <SingleCheckPage />;
      break;
    case 'bulk':
      page = <BulkVerificationPage />;
      break;
    case 'alerts':
      page = <AlertsPage />;
      break;
    case 'integrations':
      page = <IntegrationsPage />;
      break;
    case 'api':
      page = <ApiPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    case 'dashboard':
    default:
      page = <DashboardPage />;
  }

  return <AppLayout route={route}>{page}</AppLayout>;
}
