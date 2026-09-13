import { UserRepository } from '../../../domain/ports/index.js';

export class SqliteUserRepository extends UserRepository {
  constructor(db) { super(); this.db = db; }

  findById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }
  findByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
  }
  findByApiKeyHash(hash) {
    return this.db.prepare('SELECT * FROM users WHERE api_key_hash = ?').get(hash) || null;
  }
  create(user) {
    this.db.prepare(
      `INSERT INTO users (id, email, password_hash, name, credits, plan, api_key_hash, api_key_prefix)
       VALUES (@id, @email, @password_hash, @name, @credits, @plan, @api_key_hash, @api_key_prefix)`
    ).run(user);
    return user;
  }
  setApiKey(userId, hash, prefix) {
    this.db.prepare('UPDATE users SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?')
      .run(hash, prefix, userId);
  }
  // Atomic credit deduction; returns true if charged, false if insufficient.
  chargeCredits(userId, amount) {
    const info = this.db
      .prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?')
      .run(amount, userId, amount);
    return info.changes > 0;
  }
}
