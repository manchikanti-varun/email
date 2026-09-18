// Dashboard feature API slice: the overview reads the user's lists.
import { request } from '../../../services/http/client';
import type { ListSummaryRow } from '../../../types';

export const dashboardApi = {
  lists: () => request<{ lists: ListSummaryRow[] }>('GET', '/lists'),
};
