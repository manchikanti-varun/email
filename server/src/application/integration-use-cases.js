// Webhook + alert use cases.
import { AppError } from './errors.js';

export class ListWebhooks {
  constructor({ webhooks }) { this.webhooks = webhooks; }
  execute(userId) { return { webhooks: this.webhooks.findByUser(userId) }; }
}

export class AddWebhook {
  constructor({ webhooks }) { this.webhooks = webhooks; }
  execute(userId, { url, event, secret }) {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new AppError(400, 'A valid http(s) URL is required');
    }
    return this.webhooks.create({ userId, url, event: event || 'job.completed', secret: secret || null });
  }
}

export class DeleteWebhook {
  constructor({ webhooks }) { this.webhooks = webhooks; }
  execute(userId, id) {
    const changes = this.webhooks.deleteForUser(id, userId);
    if (changes === 0) throw new AppError(404, 'Webhook not found');
    return { ok: true };
  }
}

export class TestWebhooks {
  constructor({ webhookSender }) { this.webhookSender = webhookSender; }
  execute(userId) {
    this.webhookSender.fire(userId, '*', { test: true, message: 'MailHealth test event' });
    return { ok: true };
  }
}

export class ListAlerts {
  constructor({ alerts }) { this.alerts = alerts; }
  execute(userId) {
    return {
      alerts: this.alerts.findByUser(userId, 100),
      unread: this.alerts.countUnread(userId),
    };
  }
}

export class MarkAlertsRead {
  constructor({ alerts }) { this.alerts = alerts; }
  execute(userId) { this.alerts.markAllRead(userId); return { ok: true }; }
}
