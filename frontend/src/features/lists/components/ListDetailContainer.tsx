// Container for a single list's detail view. Orchestrates hooks + feature
// components; holds no fetch/endpoint/table/modal/health logic itself.
//
// Preserves the original ListDetailView composition and behavior:
//   Back link → (loading | verifying progress | full detail)
//   Header (name, totals, delta, Re-verify, Schedule…)
//   Health summary + Cleaning summary
//   Preflight → AI insights → History (when >1 point) → Contacts
import { useState } from 'react';
import { useAuth } from '../../../auth';
import { useNavigate } from '../../../lib/useHashRoute';
import { useList } from '../hooks/useList';
import { useListActions } from '../hooks/useListActions';
import { ListProgress } from './ListProgress';
import { ListHealthSummary } from './ListHealthSummary';
import { CleaningSummary } from './CleaningSummary';
import { PreflightCard } from './PreflightCard';
import { AiInsights } from './AiInsights';
import { HealthTrend } from './HealthTrend';
import { ContactTable } from './ContactTable';
import { ScheduleModal } from './ScheduleModal';

export function ListDetailContainer({ id }: { id: string }) {
  const { refreshCredits } = useAuth();
  const navigate = useNavigate();
  const { detail, progress, verifying, reload, beginVerifying } = useList(id, refreshCredits);
  const { reverify, purgeRemove, schedule } = useListActions(id, {
    onReverifyStarted: beginVerifying,
    onReload: reload,
  });
  const [showSchedule, setShowSchedule] = useState(false);

  const Back = (
    <a
      className="muted"
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={() => navigate('#/lists')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('#/lists');
        }
      }}
    >
      ← All lists
    </a>
  );

  if (!detail) {
    return (
      <>
        {Back}
        <p className="muted">Loading…</p>
      </>
    );
  }

  if (verifying) {
    return (
      <>
        {Back}
        <ListProgress name={detail.list.name} progress={progress} />
      </>
    );
  }

  const { list, summary, contacts, history, delta } = detail;

  return (
    <>
      {Back}
      <div className="toolbar">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{list.name}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {list.total.toLocaleString()} contacts · {list.duplicates} duplicates removed ·{' '}
            {delta != null && (
              <span className={delta >= 0 ? 'delta-up' : 'delta-down'}>
                {delta >= 0 ? '▲ +' : '▼ '}
                {delta} pts since last check
              </span>
            )}
          </p>
        </div>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={reverify}>Re-verify</button>
        <button className="btn ghost sm" onClick={() => setShowSchedule(true)}>Schedule…</button>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <ListHealthSummary summary={summary} />
        <CleaningSummary id={id} summary={summary} onPurgeRemove={purgeRemove} />
      </div>

      <PreflightCard id={id} />
      <AiInsights id={id} />
      {history.length > 1 && <HealthTrend history={history} />}

      <ContactTable contacts={contacts} listId={id} />

      {showSchedule && (
        <ScheduleModal onClose={() => setShowSchedule(false)} onEnable={schedule} />
      )}
    </>
  );
}
