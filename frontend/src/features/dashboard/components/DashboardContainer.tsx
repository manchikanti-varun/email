// Dashboard container: composes the overview stats + the bulk verification
// panel. Loads the user's lists for the overview; the bulk workflow itself is
// owned by the verification feature. This replaces the old DashboardView, which
// mixed overview stats with the entire upload/verify workflow.
import { useEffect, useState } from 'react';
import { useAuth } from '../../../auth';
import { PageHeader, SkeletonCards } from '../../../components/ui';
import type { ListSummaryRow } from '../../../types';
import { BulkVerificationPanel } from '../../verification/components/BulkVerificationPanel';
import { dashboardApi } from '../services/dashboard-api';
import { DashboardOverview } from './DashboardOverview';

export function DashboardContainer() {
  const { user } = useAuth();
  const [lists, setLists] = useState<ListSummaryRow[] | null>(null);

  useEffect(() => {
    dashboardApi.lists().then(({ lists }) => setLists(lists)).catch(() => setLists([]));
  }, []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Upload a list to analyze its deliverability health." />
      {lists == null ? (
        <SkeletonCards />
      ) : (
        <>
          <DashboardOverview lists={lists} user={user} />
          <BulkVerificationPanel />
        </>
      )}
    </>
  );
}
