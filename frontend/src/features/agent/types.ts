// Agent feature view types.
//
// Reuses the shared backend contracts (AgentResponse / AgentChatPayload /
// PendingConfirmation) and adds only the local chat-bubble view model. No
// duplication of backend types, no `any`.
import type { AgentResponse } from '../../types';

// The confirm payload sent back to approve a pending (often destructive) action.
export interface AgentConfirm {
  tool: string;
  args: Record<string, unknown>;
  token: string;
}

// A single rendered chat bubble in the conversation thread.
export interface AgentBubble {
  who: 'user' | 'ai';
  text?: string;
  error?: string;
  thinking?: boolean;
  response?: AgentResponse;
}
