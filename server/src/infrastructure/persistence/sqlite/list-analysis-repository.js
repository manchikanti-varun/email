// Persistence for the latest AI List Health analysis per list.
// Stores the deterministic report + diagnosis so it can be re-displayed cheaply
// without re-running the LLM. Never stores secrets, prompts, or raw addresses.
export class SqliteListAnalysisRepository {
  constructor(db) {
    this.db = db;
    this._upsert = db.prepare(
      `INSERT INTO list_analysis (list_id, user_id, health_score, health_level, metrics, diagnosis, diagnosis_source, created_at)
       VALUES (@list_id, @user_id, @health_score, @health_level, @metrics, @diagnosis, @diagnosis_source, datetime('now'))
       ON CONFLICT(list_id) DO UPDATE SET
         user_id=excluded.user_id, health_score=excluded.health_score, health_level=excluded.health_level,
         metrics=excluded.metrics, diagnosis=excluded.diagnosis, diagnosis_source=excluded.diagnosis_source,
         created_at=excluded.created_at`
    );
    this._get = db.prepare('SELECT * FROM list_analysis WHERE list_id = ? AND user_id = ?');
  }

  /**
   * @param {object} p
   * @param {string} p.listId
   * @param {string} p.userId
   * @param {number} p.healthScore
   * @param {string} p.healthLevel
   * @param {object} p.report      deterministic list-health report
   * @param {object} p.diagnosis   { summary, keyIssues, recommendations, observations }
   * @param {string} p.diagnosisSource 'ai' | 'deterministic'
   */
  save({ listId, userId, healthScore, healthLevel, report, diagnosis, diagnosisSource }) {
    this._upsert.run({
      list_id: listId,
      user_id: userId,
      health_score: healthScore,
      health_level: healthLevel,
      metrics: JSON.stringify(report ?? null),
      diagnosis: diagnosis ? JSON.stringify(diagnosis) : null,
      diagnosis_source: diagnosisSource || null,
    });
  }

  // Latest analysis for an owned list, or null. Parses stored JSON.
  findLatest(userId, listId) {
    const row = this._get.get(listId, userId);
    if (!row) return null;
    return {
      listId: row.list_id,
      healthScore: row.health_score,
      healthLevel: row.health_level,
      report: safeParse(row.metrics),
      diagnosis: safeParse(row.diagnosis),
      diagnosisSource: row.diagnosis_source,
      createdAt: row.created_at,
    };
  }
}

function safeParse(v) {
  if (v == null || v === '') return null;
  try { return JSON.parse(v); } catch { return null; }
}
