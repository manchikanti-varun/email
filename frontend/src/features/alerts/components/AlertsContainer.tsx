// Alerts container: header + mark-all-read + list/empty/loading. Composes the
// useAlerts hook and AlertItem. Extracted from AlertsView.
import { PageHeader, LoadingState, EmptyState } from '../../../components/ui';
import { useAlerts } from '../hooks/useAlerts';
import { AlertItem } from './AlertItem';

export function AlertsContainer() {
  const { alerts, markRead } = useAlerts();

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Health drops and data-quality changes across your lists."
        actions={
          <button className="btn ghost sm" onClick={markRead}>Mark all read</button>
        }
      />

      {alerts == null ? (
        <LoadingState />
      ) : alerts.length === 0 ? (
        <EmptyState title="No alerts.">Your lists are healthy. Health drops and data-quality changes will show up here.</EmptyState>
      ) : (
        alerts.map((a) => <AlertItem key={a.id} alert={a} />)
      )}
    </>
  );
}
