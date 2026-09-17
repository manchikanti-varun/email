// Email-list use cases: upload, verify, progress, index, detail, cleaning
// plan, export data, bulk actions, scheduling, delete. All orchestration lives
// here; the interface layer only maps HTTP <-> these calls.
import { nanoid } from 'nanoid';
import { AppError } from './errors.js';

export class UploadList {
  constructor({ lists, contacts, parseUpload }) {
    this.lists = lists;
    this.contacts = contacts;
    this.parseUpload = parseUpload;
  }

  /**
   * @param {string} userId
   * @param {Buffer} fileBuffer
   * @param {string} originalName
   * @param {{ onProgress?: (evt: { stage: string, total?: number }) => void }} [opts]
   */
  execute(userId, fileBuffer, originalName, opts = {}) {
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    if (!fileBuffer) throw new AppError(400, 'No file uploaded');

    const t0 = Date.now();
    onProgress?.({ stage: 'parsing' });
    const { emails, duplicates, columnHint, rawCount } = this.parseUpload(fileBuffer, originalName);
    if (emails.length === 0) throw new AppError(400, 'No email addresses found in the file');
    const parseMs = Date.now() - t0;

    const listId = nanoid();
    this.lists.create({
      id: listId, userId, name: originalName, source: columnHint,
      total: emails.length, duplicates, status: 'pending',
    });

    const t1 = Date.now();
    onProgress?.({ stage: 'saving', total: emails.length });
    this.contacts.insertMany(listId, emails);
    const saveMs = Date.now() - t1;

    onProgress?.({ stage: 'done', total: emails.length });
    return {
      listId,
      total: emails.length,
      duplicates,
      rawCount,
      columnHint,
      timings: { parseMs, saveMs, totalMs: parseMs + saveMs },
    };
  }
}

export class StartListVerification {
  constructor({ lists, contacts, users, queue }) {
    this.lists = lists;
    this.contacts = contacts;
    this.users = users;
    this.queue = queue;
  }

  execute(userId, listId, reverify = false) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');
    if (list.status === 'verifying') throw new AppError(409, 'Already verifying');

    const pending = this.contacts.countPending(list.id, reverify);
    if (pending === 0) throw new AppError(400, 'Nothing to verify');
    if (!this.users.chargeCredits(userId, pending)) {
      throw new AppError(402, 'Insufficient credits', { needed: pending });
    }

    if (reverify) this.contacts.resetVerification(list.id);
    const jobId = this.queue.enqueue(userId, list.id, reverify ? 'reverify' : 'verify');
    return { started: true, jobId, total: pending };
  }
}

export class GetListProgress {
  constructor({ lists, jobs }) { this.lists = lists; this.jobs = jobs; }

  execute(userId, listId) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');
    const job = this.jobs.latestForList(listId);
    return { status: list.status, done: job?.done ?? 0, total: job?.total ?? 0 };
  }
}

export class GetLists {
  constructor({ lists }) { this.lists = lists; }

  execute(userId) {
    const rows = this.lists.findAllForUser(userId);
    return { lists: rows.map((l) => ({ ...l, health: this.lists.latestHealth(l.id) })) };
  }
}

export class GetListDetail {
  constructor({ lists, contacts, history, summarize }) {
    this.lists = lists;
    this.contacts = contacts;
    this.history = history;
    this.summarize = summarize;
  }

  execute(userId, listId) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    const contacts = this.contacts.findByList(list.id);
    const summary = this.summarize(contacts);
    const history = this.history.findByList(list.id);

    let delta = null;
    if (history.length >= 2) {
      delta = Math.round(
        (history[history.length - 1].health - history[history.length - 2].health) * 10
      ) / 10;
    }
    return { list, summary, contacts, history, delta };
  }
}

export class GetCleaningPlan {
  constructor({ lists, contacts }) { this.lists = lists; this.contacts = contacts; }

  execute(userId, listId) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    const contacts = this.contacts.findByList(list.id);
    const plan = { keep: [], review: [], remove: [] };
    for (const c of contacts) {
      if (c.classification === 'safe') plan.keep.push(c.email);
      else if (c.classification === 'remove') plan.remove.push(c.email);
      else plan.review.push(c.email); // review + unknown
    }
    return {
      keep: plan.keep.length,
      review: plan.review.length,
      remove: plan.remove.length,
      campaignReady: plan.keep.length,
      plan,
    };
  }
}

// Returns the list + filtered contact rows; the interface layer formats CSV/XLSX.
export class GetExportData {
  constructor({ lists, contacts }) { this.lists = lists; this.contacts = contacts; }

  execute(userId, listId, filter = 'all') {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    let contacts = this.contacts.findByList(list.id);
    if (filter === 'campaign') contacts = contacts.filter((c) => c.classification === 'safe');
    else if (['safe', 'review', 'remove', 'unknown'].includes(filter)) {
      contacts = contacts.filter((c) => c.classification === filter);
    }
    return { list, contacts, filter };
  }
}

export class BulkDeleteByClassification {
  constructor({ lists, contacts }) { this.lists = lists; this.contacts = contacts; }

  execute(userId, listId, action, classification) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    if (action === 'delete-by-classification' &&
        ['safe', 'review', 'remove', 'unknown'].includes(classification)) {
      const deleted = this.contacts.deleteByClassification(list.id, classification);
      this.lists.updateTotalFromContacts(list.id);
      return { ok: true, deleted };
    }
    throw new AppError(400, 'Unsupported action');
  }
}

export class ScheduleReverification {
  constructor({ lists, schedules }) { this.lists = lists; this.schedules = schedules; }

  execute(userId, listId, intervalDaysRaw, enabledRaw) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');
    const intervalDays = Math.max(1, parseInt(intervalDaysRaw || '7', 10));
    const enabled = enabledRaw !== false;
    this.schedules.upsert(list.id, intervalDays, enabled);
    return { ok: true, intervalDays, enabled };
  }
}

export class DeleteList {
  constructor({ lists }) { this.lists = lists; }

  execute(userId, listId) {
    const changes = this.lists.deleteForUser(listId, userId);
    if (changes === 0) throw new AppError(404, 'List not found');
    return { ok: true };
  }
}
