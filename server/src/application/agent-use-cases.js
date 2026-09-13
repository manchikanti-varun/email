// Application use-case that adapts the HTTP layer to the agent runtime. Keeps
// the interface layer thin and the agent framework decoupled from Express.
import { AppError } from './errors.js';

export class AgentChat {
  constructor({ agent }) { this.agent = agent; }

  async execute(user, { message, listId, conversationId, confirm } = {}) {
    if (typeof message !== 'string' && !confirm) {
      throw new AppError(400, 'A message is required');
    }
    return this.agent.run({ user, message: message || '', listId, conversationId, confirm });
  }
}

export class AgentHistory {
  constructor({ audit }) { this.audit = audit; }
  execute(userId, conversationId) {
    if (conversationId) return { entries: this.audit.findByConversation(userId, conversationId, 100) };
    return { entries: this.audit.findByUser(userId, 50) };
  }
}
