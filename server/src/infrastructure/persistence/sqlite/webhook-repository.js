import { nanoid } from 'nanoid';
import { WebhookRepository } from '../../../domain/ports/index.js';
import { SecretCipher } from '../../security/secret-crypto.js';

// Webhook persistence with signing-secrets ENCRYPTED AT REST (H2).
//
// The signing secret is required later to compute HMAC-SHA256(secret, body) for
// outgoing deliveries, so it cannot be one-way hashed. Instead it is stored
// encrypted (AES-256-GCM) in `secret_enc` and decrypted only when a delivery
// needs to sign. The legacy plaintext `secret` column is read as a fallback for
// un-migrated rows and is never written by new code.
export class SqliteWebhookRepository extends WebhookRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {import('../../security/secret-crypto.js').SecretCipher} [cipher]
   *   Optional. When absent, secrets are stored as-is (legacy behavior) — used
   *   only by tests that don't exercise encryption. Production always injects one.
   */
  constructor(db, cipher = null) {
    super();
    this.db = db;
    this.cipher = cipher;
  }

  // Public listing (no secret material of any kind exposed).
  findByUser(userId) {
    return this.db.prepare(
      'SELECT id, url, event, active, created_at FROM webhooks WHERE user_id = ?'
    ).all(userId);
  }

  // Active hooks matching an event (or wildcard). Returns a DECRYPTED `secret`
  // for signing. Decryption failures surface as an error (fail closed) rather
  // than silently signing with ciphertext or a wrong value.
  findMatching(userId, event) {
    const rows = this.db.prepare(
      "SELECT id, url, event, active, secret, secret_enc FROM webhooks WHERE user_id = ? AND active = 1 AND (event = ? OR event = '*')"
    ).all(userId, event);
    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      event: row.event,
      active: row.active,
      secret: this._readSecret(row),
    }));
  }

  create({ userId, url, event = 'job.completed', secret = null }) {
    const id = nanoid();
    const enc = this._encryptSecret(secret);
    // New rows never store plaintext: `secret` stays NULL, `secret_enc` holds
    // the envelope (or NULL when no secret was provided).
    this.db.prepare(
      'INSERT INTO webhooks (id, user_id, url, event, secret, secret_enc) VALUES (?, ?, ?, ?, NULL, ?)'
    ).run(id, userId, url, event, enc);
    return { id, url, event };
  }

  deleteForUser(id, userId) {
    return this.db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(id, userId).changes;
  }

  // ---- secret handling ----------------------------------------------------
  _encryptSecret(secret) {
    if (secret == null || secret === '') return null;
    if (!this.cipher) return secret; // legacy/no-cipher mode (tests only)
    return this.cipher.encrypt(String(secret));
  }

  _readSecret(row) {
    // Prefer the encrypted column; fall back to any legacy plaintext.
    if (row.secret_enc != null && row.secret_enc !== '') {
      if (SecretCipher.isEnvelope(row.secret_enc)) {
        if (!this.cipher) throw new Error('encrypted webhook secret present but no cipher configured');
        return this.cipher.decrypt(row.secret_enc); // throws on tamper/wrong key -> fail closed
      }
      return row.secret_enc; // stored without encryption (no-cipher mode)
    }
    return row.secret ?? null;
  }

  /**
   * One-time migration: encrypt any leftover plaintext `secret` into
   * `secret_enc` and NULL the plaintext. Idempotent — rows already migrated
   * (secret IS NULL) are skipped. Requires a cipher; a no-op without one.
   * @returns {number} rows migrated
   */
  migratePlaintextSecrets() {
    if (!this.cipher) return 0;
    const rows = this.db.prepare(
      "SELECT id, secret FROM webhooks WHERE secret IS NOT NULL AND secret <> ''"
    ).all();
    if (rows.length === 0) return 0;
    const upd = this.db.prepare('UPDATE webhooks SET secret_enc = ?, secret = NULL WHERE id = ?');
    const tx = this.db.transaction(() => {
      for (const r of rows) upd.run(this.cipher.encrypt(String(r.secret)), r.id);
    });
    tx();
    return rows.length;
  }
}
