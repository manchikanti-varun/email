// Top-level agent composition: header + quick actions + conversation + composer
// + confirmation modal. Owns no data logic — it uses the useAgent hook. This
// replaces the monolithic AgentView while preserving its exact behavior.
import { useAgent } from '../hooks/useAgent';
import { AgentQuickActions } from './AgentQuickActions';
import { AgentConversation } from './AgentConversation';
import { AgentInput } from './AgentInput';
import { AgentConfirmModal } from './AgentConfirmModal';

export function AgentPanel({ listId }: { listId: string | null }) {
  const {
    bubbles,
    input,
    setInput,
    busy,
    pending,
    setPending,
    submit,
    confirmPending,
    sessionListId,
  } = useAgent(listId);

  return (
    <div className="agent-wrap">
      <div className="agent-head">
        <div className="agent-title">
          <span className="agent-glyph">🧠</span> MailHealth AI
        </div>
        <p className="agent-sub">
          Ask me about your email lists. I investigate your list health and can perform approved actions — I never
          guess verification results.
        </p>
      </div>

      <AgentQuickActions onPick={submit} />

      <AgentConversation
        bubbles={bubbles}
        sessionListId={sessionListId()}
        onRequestConfirm={setPending}
      />

      <AgentInput value={input} onChange={setInput} onSubmit={() => submit()} disabled={busy} />

      {pending && (
        <AgentConfirmModal
          pending={pending}
          onCancel={() => setPending(null)}
          onConfirm={confirmPending}
        />
      )}
    </div>
  );
}
