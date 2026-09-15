import { nanoid } from 'nanoid';
import { ContactRepository } from '../../../domain/ports/index.js';
import { toDomainContact } from '../../../domain/entities/contact.js';

export class SqliteContactRepository extends ContactRepository {
  constructor(db) {
    super();
    this.db = db;
    this._update = db.prepare(
      `UPDATE contacts SET score=?, classification=?, status=?, signals=?, reasons=?,
         recommendation=?, greylisted=?, provider=?, retry_after=?,
         deliverability=?, confidence=?, recommended_action=?, risk_signals=?,
         calibrated_confidence=?, calibration_level=?, calibration_model=?,
         verified_at=? WHERE id=?`
    );
  }

  insertMany(listId, emails) {
    const insert = this.db.prepare('INSERT INTO contacts (id, list_id, email) VALUES (?, ?, ?)');
    const tx = this.db.transaction((items) => {
      for (const e of items) insert.run(nanoid(), listId, e);
    });
    tx(emails);
  }

  // Full list, mapped to domain contacts (JSON parsed, camelCase aliases).
  findByList(listId) {
    return this.db.prepare('SELECT * FROM contacts WHERE list_id = ?')
      .all(listId).map(toDomainContact);
  }

  // Raw rows (id + email) that a job of the given type still needs to process.
  findPending(listId, type) {
    if (type === 'retry') {
      return this.db.prepare(
        `SELECT id, email FROM contacts
         WHERE list_id = ? AND (retry_after IS NOT NULL AND retry_after <= datetime('now'))`
      ).all(listId);
    }
    if (type === 'reverify') {
      return this.db.prepare('SELECT id, email FROM contacts WHERE list_id = ?').all(listId);
    }
    return this.db.prepare(
      'SELECT id, email FROM contacts WHERE list_id = ? AND verified_at IS NULL'
    ).all(listId);
  }

  countPending(listId, reverify) {
    return reverify
      ? this.db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ?').get(listId).n
      : this.db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ? AND verified_at IS NULL').get(listId).n;
  }

  countByList(listId) {
    return this.db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ?').get(listId).n;
  }

  // Persist a verification result to a contact. Computes retry_after for
  // greylisted addresses (retry in 30 minutes), matching the original queue.
  saveResult(contactId, r) {
    const retryAfter = r.greylisted
      ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
      : null;
    const tx = this.db.transaction(() => {
      // ML calibration is OPTIONAL and additive. When a calibration block is
      // present on the result we persist its reliability estimate; otherwise we
      // write NULLs. The deterministic verdict columns are unaffected.
      const cal = r.confidenceCalibration || null;
      const calScore = cal && Number.isFinite(cal.score) ? cal.score : null;
      const calLevel = cal && cal.level ? cal.level : null;
      const calModel = cal && cal.model ? cal.model : null;
      this._update.run(
        r.score, r.classification, r.status,
        JSON.stringify(r.signals), JSON.stringify(r.reasons),
        r.recommendation, r.greylisted ? 1 : 0, r.provider, retryAfter,
        r.deliverability, r.confidence, r.recommendedAction,
        JSON.stringify(r.riskSignals || []),
        calScore, calLevel, calModel,
        r.verified_at, contactId
      );
    });
    tx();
  }

  resetVerification(listId) {
    this.db.prepare('UPDATE contacts SET verified_at = NULL WHERE list_id = ?').run(listId);
  }

  deleteByClassification(listId, classification) {
    return this.db.prepare('DELETE FROM contacts WHERE list_id = ? AND classification = ?')
      .run(listId, classification).changes;
  }

  // Distinct list ids that have contacts due for a greylist retry.
  listsWithDueRetries() {
    return this.db.prepare(
      `SELECT DISTINCT list_id FROM contacts
       WHERE retry_after IS NOT NULL AND retry_after <= datetime('now')`
    ).all().map((r) => r.list_id);
  }
}
