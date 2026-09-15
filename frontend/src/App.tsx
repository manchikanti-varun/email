import { useAuth } from './auth';
import { useHashRoute } from './lib/useHashRoute';
import { AuthView } from './views/AuthView';
import { Shell } from './components/Shell';
import { DashboardView } from './views/DashboardView';
import { ListsView } from './views/ListsView';
import { ListDetailView } from './views/ListDetailView';
import { SingleCheckView } from './views/SingleCheckView';
import { AlertsView } from './views/AlertsView';
import { IntegrationsView } from './views/IntegrationsView';
import { ApiView } from './views/ApiView';
import { AgentView } from './views/AgentView';

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

  if (!user) return <AuthView />;

  let view;
  switch (route) {
    case 'lists':
      view = param ? <ListDetailView key={param} id={param} /> : <ListsView />;
      break;
    case 'agent':
      view = <AgentView listId={param} />;
      break;
    case 'single':
      view = <SingleCheckView />;
      break;
    case 'alerts':
      view = <AlertsView />;
      break;
    case 'integrations':
      view = <IntegrationsView />;
      break;
    case 'api':
      view = <ApiView />;
      break;
    case 'dashboard':
    default:
      view = <DashboardView />;
  }

  return (
    <Shell route={route}>{view}</Shell>
  );
}
