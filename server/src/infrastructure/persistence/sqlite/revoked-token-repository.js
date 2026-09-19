import { RevokedTokenRepository } from '../../../domain/ports/index.js';

// Persists revoked JWT identifiers (jti) so a logged-out (or explicitly
// revoked) token can no longer authenticate. Stores only the jti, the owning
// user id, and the token's natural expiry — never token material.
export class SqliteRevokedTokenRepository extends RevokedTokenRepository {
  constructor(db) {
    super();
    this.db = db;
    // Store expiry in SQLite's canonical 'YYYY-MM-DD HH:MM:SS' UTC format via
    // datetime(?), so comparisons against datetime('now') order correctly
    // regardless of the input format (ISO-8601 'T...Z' would otherwise sort
    // after the space-separated format and never be swept).
    this._insert = db.prepare(
      `INSERT INTO revoked_tokens (jti, user_id, expires_at)
       VALUES (?, ?, datetime(?))
       ON CONFLICT(jti) DO NOTHING`
    );
    this._exists = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ? LIMIT 1');
    this._cleanup = db.prepare("DELETE FROM revoked_tokens WHERE expires_at <= datetime('now')");
  }

  /**
   * @param {string} jti          token id to revoke
   * @param {string} expiresAtIso ISO instant the token naturally expires
   * @param {string} [userId]
   */
  revoke(jti, expiresAtIso, userId = null) {
    if (!jti) return;
    this._insert.run(jti, userId, expiresAtIso);
  }

  // Throws if the query fails so callers can fail CLOSED for authentication.
  isRevoked(jti) {
    if (!jti) return false;
    return !!this._exists.get(jti);
  }

  // Sweep entries whose tokens have already expired. Returns rows removed.
  cleanupExpired() {
    return this._cleanup.run().changes;
  }
}
