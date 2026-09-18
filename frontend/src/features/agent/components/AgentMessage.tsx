// Renders one chat bubble: a user message, the "thinking" placeholder, an error
// bubble, or a full AI response (steps → text → sources → actions → meta).
// Extracted verbatim from AgentView's bubble rendering.
//
// The AI response is advisory: it narrates tool results and recommendations and
// can propose actions requiring confirmation, but it never displays or alters
// authoritative mailbox verdicts here.
import { useNavigate } from '../../../lib/useHashRoute';
import type { PendingConfirmation } from '../../../types';
import type { AgentBubble } from '../types';
import { AgentText } from './AgentText';
import { STEP_LABELS, stepClass } from './agent-constants';

export function AgentMessage({
  bubble,
  sessionListId,
  onRequestConfirm,
  announce = false,
}: {
  bubble: AgentBubble;
  sessionListId?: string;
  onRequestConfirm: (p: PendingConfirmation) => void;
  announce?: boolean;
}) {
  const navigate = useNavigate();
  const liveProps = announce ? ({ 'aria-live': 'polite' as const, role: 'status' }) : {};

  if (bubble.who === 'user') {
    return (
      <div className="agent-msg user">
        <div className="agent-body">
          <div className="agent-text">{bubble.text}</div>
        </div>
      </div>
    );
  }

  if (bubble.thinking) {
    return (
      <div className="agent-msg ai">
        <div className="agent-avatar">AI</div>
        <div className="agent-body">
          <div className="agent-steps">
            <span className="agent-step">Thinking…</span>
          </div>
        </div>
      </div>
    );
  }

  if (bubble.error) {
    return (
      <div className="agent-msg ai" {...liveProps}>
        <div className="agent-avatar">AI</div>
        <div className="agent-body">
          <div className="agent-text">
            <span className="error">{bubble.error}</span>
          </div>
        </div>
      </div>
    );
  }

  const res = bubble.response!;
  const lid = sessionListId || res.pendingConfirmation?.args?.listId;

  return (
    <div className="agent-msg ai" {...liveProps}>
      <div className="agent-avatar">AI</div>
      <div className="agent-body">
        {res.actions && res.actions.length > 0 && (
          <div className="agent-steps">
            {res.actions.map((a, j) => (
              <span key={j} className={`agent-step ${stepClass(a.status)}`}>
                {STEP_LABELS[a.tool] || a.tool}
              </span>
            ))}
          </div>
        )}
        <div className="agent-text">
          <AgentText text={res.message} />
        </div>
        {res.sources && res.sources.length > 0 && (
          <div className="agent-sources">
            {res.sources.map((s, j) => (
              <span key={j} className="agent-source" title={s.label}>
                ✓ {s.label}
              </span>
            ))}
          </div>
        )}
        <div className="agent-actions">
          {lid && (
            <button className="btn ghost sm" onClick={() => navigate('#/lists/' + lid)}>
              View contacts
            </button>
          )}
          {res.pendingConfirmation && (
            <button className="btn sm" onClick={() => onRequestConfirm(res.pendingConfirmation!)}>
              {res.pendingConfirmation.permission === 'destructive' ? 'Review & confirm' : 'Confirm'}
            </button>
          )}
        </div>
        <div className="agent-meta">
          {res.model || ''}
          {res.latency ? ' · ' + res.latency + 'ms' : ''}
          {res.estimatedCost ? ' · ~$' + res.estimatedCost.toFixed(4) : ''}
        </div>
      </div>
    </div>
  );
}
