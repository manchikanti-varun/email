// Webhook + alert use cases.
import { AppError } from './errors.js';

// SSRF protection: block webhook URLs pointing to private / internal IPs.
// An attacker who registers http://169.254.169.254/... as a webhook URL could
// exfiltrate cloud metadata or hit internal services when the webhook fires.
const PRIVATE_IP_RE =
  /^(https?:\/\/)?(\[::1\]|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|\[0:0:0:0:0:0:0:0\]|\[::ffff:127\.\d+\.\d+\.\d+\]|\[::ffff:(10|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\]|localhost|\.local|\.internal|\.localhost)([/:?#]|$)/i;

// Reserved metadata / link-local address ranges.
const LINKLOCAL_RE = /^(https?:\/\/)?(169\.254\.\d+\.\d+|\[fe80:|\[fd[0-9a-f]{2}:)/i;

export function isUnsafeUrl(url) {
  try {
    const u = new URL(url);
    // Only allow http(s).
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const host = u.hostname.toLowerCase();
    if (PRIVATE_IP_RE.test(url) || LINKLOCAL_RE.test(url)) return true;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
    return false;
  } catch {
    return true; // malformed URL
  }
}

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
    if (isUnsafeUrl(url)) {
      throw new AppError(400, 'Webhook URL must point to a public internet address (private/internal IPs are blocked)');
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
