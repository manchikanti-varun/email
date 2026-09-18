// MailHealth AI agent page. Thin: composes the agent feature panel.
// `listId` comes from the #/agent/:id route param (optional).
import { AgentPanel } from '../features/agent/components/AgentPanel';

export function AgentPage({ listId }: { listId: string | null }) {
  return <AgentPanel listId={listId} />;
}
