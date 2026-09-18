// Schedule re-verification modal. Extracted verbatim from ListDetailView.
import { useState } from 'react';
import { Modal } from '../../../components/ui';

export function ScheduleModal({
  onClose,
  onEnable,
}: {
  onClose: () => void;
  onEnable: (days: number) => void | Promise<void>;
}) {
  const [days, setDays] = useState(7);
  return (
    <Modal onClose={onClose} cardStyle={{ maxWidth: 420 }}>
      <h3 style={{ marginTop: 0 }}>Schedule re-verification</h3>
      <p className="muted">Automatically re-verify this list on a recurring interval to track health over time.</p>
      <div className="field">
        <label htmlFor="schedule-days">Interval (days)</label>
        <input
          id="schedule-days"
          type="number"
          value={days}
          min={1}
          onChange={(e) => setDays(parseInt(e.target.value, 10) || 7)}
        />
      </div>
      <div className="toolbar">
        <button
          className="btn"
          onClick={async () => {
            await onEnable(days);
            onClose();
          }}
        >
          Enable
        </button>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
