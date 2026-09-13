// Domain ports (interfaces / contracts).
//
// These are the boundaries the inner layers (domain, application) depend on.
// Infrastructure provides concrete implementations; nothing in here imports a
// framework, a driver, or Node's network modules. In JS we express a "port" as
// a base class whose methods throw until implemented — it documents the
// contract and fails loudly if an adapter forgets a method.

function notImplemented(name) {
  throw new Error(`${name} not implemented`);
}

// ---- Repositories ---------------------------------------------------------

export class UserRepository {
  findById(_id) { notImplemented('UserRepository.findById'); }
  findByEmail(_email) { notImplemented('UserRepository.findByEmail'); }
  findByApiKeyHash(_hash) { notImplemented('UserRepository.findByApiKeyHash'); }
  create(_user) { notImplemented('UserRepository.create'); }
  setApiKey(_userId, _hash, _prefix) { notImplemented('UserRepository.setApiKey'); }
  // Atomic credit deduction; returns true if charged, false if insufficient.
  chargeCredits(_userId, _amount) { notImplemented('UserRepository.chargeCredits'); }
}

export class ListRepository {
  create(_list) { notImplemented('ListRepository.create'); }
  findByIdForUser(_id, _userId) { notImplemented('ListRepository.findByIdForUser'); }
  findAllForUser(_userId) { notImplemented('ListRepository.findAllForUser'); }
  setStatus(_id, _status) { notImplemented('ListRepository.setStatus'); }
  updateTotalFromContacts(_id) { notImplemented('ListRepository.updateTotalFromContacts'); }
  deleteForUser(_id, _userId) { notImplemented('ListRepository.deleteForUser'); }
  latestHealth(_id) { notImplemented('ListRepository.latestHealth'); }
}

export class ContactRepository {
  insertMany(_listId, _emails) { notImplemented('ContactRepository.insertMany'); }
  findByList(_listId) { notImplemented('ContactRepository.findByList'); }
  findPending(_listId, _type) { notImplemented('ContactRepository.findPending'); }
  countPending(_listId, _reverify) { notImplemented('ContactRepository.countPending'); }
  saveResult(_contactId, _result) { notImplemented('ContactRepository.saveResult'); }
  resetVerification(_listId) { notImplemented('ContactRepository.resetVerification'); }
  deleteByClassification(_listId, _classification) { notImplemented('ContactRepository.deleteByClassification'); }
  listsWithDueRetries() { notImplemented('ContactRepository.listsWithDueRetries'); }
}

export class HistoryRepository {
  add(_listId, _snapshot) { notImplemented('HistoryRepository.add'); }
  findByList(_listId) { notImplemented('HistoryRepository.findByList'); }
  latest(_listId, _limit) { notImplemented('HistoryRepository.latest'); }
}

export class JobRepository {
  create(_job) { notImplemented('JobRepository.create'); }
  nextRunnable() { notImplemented('JobRepository.nextRunnable'); }
  latestForList(_listId) { notImplemented('JobRepository.latestForList'); }
  markRunning(_id) { notImplemented('JobRepository.markRunning'); }
  updateProgress(_id, _done) { notImplemented('JobRepository.updateProgress'); }
  markDone(_id, _done) { notImplemented('JobRepository.markDone'); }
  countUnfinished() { notImplemented('JobRepository.countUnfinished'); }
}

export class WebhookRepository {
  findByUser(_userId) { notImplemented('WebhookRepository.findByUser'); }
  findMatching(_userId, _event) { notImplemented('WebhookRepository.findMatching'); }
  create(_hook) { notImplemented('WebhookRepository.create'); }
  deleteForUser(_id, _userId) { notImplemented('WebhookRepository.deleteForUser'); }
}

export class AlertRepository {
  create(_alert) { notImplemented('AlertRepository.create'); }
  findByUser(_userId, _limit) { notImplemented('AlertRepository.findByUser'); }
  countUnread(_userId) { notImplemented('AlertRepository.countUnread'); }
  markAllRead(_userId) { notImplemented('AlertRepository.markAllRead'); }
}

export class ScheduleRepository {
  upsert(_listId, _intervalDays, _enabled) { notImplemented('ScheduleRepository.upsert'); }
  findDue() { notImplemented('ScheduleRepository.findDue'); }
  setNextRun(_listId, _nextRunIso) { notImplemented('ScheduleRepository.setNextRun'); }
  delete(_listId) { notImplemented('ScheduleRepository.delete'); }
}

export class AgentAuditRepository {
  // Persist a single tool-invocation audit entry (secrets already redacted).
  record(_entry) { notImplemented('AgentAuditRepository.record'); }
  // Recent entries for a user, newest first.
  findByUser(_userId, _limit) { notImplemented('AgentAuditRepository.findByUser'); }
  // Recent entries within a single conversation/task.
  findByConversation(_userId, _conversationId, _limit) { notImplemented('AgentAuditRepository.findByConversation'); }
}

// ---- Gateways / services --------------------------------------------------

export class DnsResolver {
  // -> { domainExists, hasMx, mxHosts, aRecord }
  resolveDomain(_domain) { notImplemented('DnsResolver.resolveDomain'); }
}

export class SmtpProbe {
  // -> { reachable, mailboxExists, mailboxRejected, temporaryFailure, catchAll, ... }
  check(_email, _mxHosts) { notImplemented('SmtpProbe.check'); }
  // -> { available, reason, detail }
  selfTest() { notImplemented('SmtpProbe.selfTest'); }
}

export class VerificationProvider {
  get name() { return 'none'; }
  // -> { deliverable: true|false|null, catchAll, raw, provider }
  verify(_email, _context) { notImplemented('VerificationProvider.verify'); }
}

export class WebhookSender {
  // Fire-and-forget delivery of an event to a user's matching webhooks.
  fire(_userId, _event, _data) { notImplemented('WebhookSender.fire'); }
}

export class PasswordHasher {
  hash(_plain) { notImplemented('PasswordHasher.hash'); }
  verify(_plain, _hash) { notImplemented('PasswordHasher.verify'); }
}

export class TokenService {
  sign(_user) { notImplemented('TokenService.sign'); }
  verify(_token) { notImplemented('TokenService.verify'); } // -> userId | null
}

export class ApiKeyService {
  generate() { notImplemented('ApiKeyService.generate'); } // -> { raw, hash, prefix }
  hash(_raw) { notImplemented('ApiKeyService.hash'); }
}

export class Clock {
  now() { return new Date(); }
  nowIso() { return new Date().toISOString(); }
}
