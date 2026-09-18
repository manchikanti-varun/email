// Conversation + confirmation state for the MailHealth AI agent.
//
// Behavior mirrors the original AgentView exactly:
//   - send(message, confirm?) pushes a user bubble (when there's a message) and
//     a "thinking" placeholder, calls the JSON chat endpoint, then replaces the
//     placeholder with the response (or an error bubble)
//   - the conversationId + listId persist across turns via a ref (session)
//   - confirmPending() approves a pending action with its token and refreshes
//     credits (a confirmed action may spend credits)
// No streaming. No auto-execution of actions — confirmation is required exactly
// as before.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../auth';
import type { PendingConfirmation } from '../../../types';
import type { AgentBubble, AgentConfirm } from '../types';
import { agentApi } from '../services/agent-api';

export function useAgent(paramListId: string | null) {
  const { refreshCredits } = useAuth();
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const session = useRef<{ conversationId?: string; listId?: string }>({
    listId: paramListId || undefined,
  });

  useEffect(() => {
    if (paramListId) session.current.listId = paramListId;
  }, [paramListId]);

  const send = useCallback(
    async (message: string, confirm?: AgentConfirm) => {
      if ((!message && !confirm) || busy) return;
      setBusy(true);

      setBubbles((prev) => {
        const next = [...prev];
        if (message) next.push({ who: 'user', text: message });
        next.push({ who: 'ai', thinking: true });
        return next;
      });

      try {
        const res = await agentApi.chat({
          message,
          listId: session.current.listId,
          conversationId: session.current.conversationId,
          confirm,
        });
        session.current.conversationId = res.conversationId || session.current.conversationId;
        setBubbles((prev) => {
          const next = prev.filter((b) => !b.thinking);
          next.push({ who: 'ai', response: res });
          return next;
        });
      } catch (e) {
        setBubbles((prev) => {
          const next = prev.filter((b) => !b.thinking);
          next.push({ who: 'ai', error: e instanceof Error ? e.message : 'Something went wrong' });
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const submit = useCallback(
    (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || busy) return;
      setInput('');
      send(msg);
    },
    [input, busy, send],
  );

  const confirmPending = useCallback(() => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    send('', { tool: p.tool, args: p.args, token: p.token });
    refreshCredits();
  }, [pending, send, refreshCredits]);

  // The current session list id, used for the "View contacts" affordance.
  const sessionListId = () => session.current.listId;

  return {
    bubbles,
    input,
    setInput,
    busy,
    pending,
    setPending,
    submit,
    confirmPending,
    sessionListId,
  };
}
