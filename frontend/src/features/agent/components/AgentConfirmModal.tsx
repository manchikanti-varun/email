// Confirmation dialog for agent-requested actions. Destructive actions get an
// extra "cannot be undone" warning and a red confirm button. This preserves the
// existing safety flow exactly — actions are NEVER auto-executed; the user must
// confirm here. Extracted from AgentView.
import type { PendingConfirmation } from '../../../types';
import { Modal } from '../../../components/ui';

export function AgentConfirmModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const destructive = pending.permission === 'destructive';
  return (
    <Modal
      onClose={onCancel}
      cardClassName={`agent-confirm ${destructive ? 'danger' : ''}`}
      cardStyle={{ maxWidth: 440 }}
    >
      <div className="agent-confirm-head">
        {destructive ? '⚠ Confirmation required' : '● Confirmation required'}
      </div>
      <p className="agent-confirm-body">{pending.summary}?</p>
      {destructive && <p className="agent-confirm-warn">This action cannot be undone.</p>}
      <div className="toolbar" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className={`btn ${destructive ? 'danger' : ''}`} onClick={onConfirm}>
          {destructive ? 'Confirm removal' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}
