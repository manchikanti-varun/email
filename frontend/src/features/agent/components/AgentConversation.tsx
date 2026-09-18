// The scrolling conversation thread: empty prompt when no messages, otherwise
// the list of bubbles. Autoscrolls to the newest message. Extracted from
// AgentView. Uses aria-live="polite" so new AI messages are announced without
// re-reading the whole thread.
import { useEffect, useRef } from 'react';
import type { PendingConfirmation } from '../../../types';
import type { AgentBubble } from '../types';
import { AgentMessage } from './AgentMessage';

export function AgentConversation({
  bubbles,
  sessionListId,
  onRequestConfirm,
}: {
  bubbles: AgentBubble[];
  sessionListId?: string;
  onRequestConfirm: (p: PendingConfirmation) => void;
}) {
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [bubbles]);

  const lastIndex = bubbles.length - 1;

  return (
    <div className="agent-thread" ref={threadRef}>
      {bubbles.length === 0 && (
        <div className="agent-empty">
          <p>
            <b>Try:</b> "Is my customer list ready to send?" · "Why did my health drop?" · "Find risky contacts" ·
            "Clean my list"
          </p>
        </div>
      )}

      {bubbles.map((b, i) => (
        <AgentMessage
          key={i}
          bubble={b}
          sessionListId={sessionListId}
          onRequestConfirm={onRequestConfirm}
          // Announce only the newest AI message (response/error), so screen
          // readers hear new answers without re-reading the whole thread.
          announce={i === lastIndex && b.who === 'ai' && !b.thinking}
        />
      ))}
    </div>
  );
}
