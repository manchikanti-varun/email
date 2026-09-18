// Agent feature API slice.
//
// The MailHealth AI agent uses a plain JSON request/response — there is NO
// streaming (confirmed against server/src/interfaces/http/routes/agent-routes.js
// and the AgentChat use-case). Requests are identical to the original
// api.agentChat/api.agentHistory. Built on the shared HTTP client.
import { request } from '../../../services/http/client';
import type { AgentResponse, AgentChatPayload } from '../../../types';

export const agentApi = {
  // POST /agent/chat { message, listId?, conversationId?, confirm? }
  chat: (payload: AgentChatPayload) => request<AgentResponse>('POST', '/agent/chat', payload),

  // GET /agent/history?conversationId=… — read-only audit trail.
  history: (conversationId?: string) =>
    request(
      'GET',
      '/agent/history' +
        (conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''),
    ),
};
