// Test harness: builds the REAL Express app (buildApp) wired to REAL use cases,
// repositories and security services, backed by a TEMPORARY SQLite database.
// This exercises the full HTTP boundary (routing + middleware + validation +
// persistence) WITHOUT importing the production config/connection singleton,
// so it is unaffected by the workspace .env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { buildApp } from '../../app.js';

import { SqliteUserRepository } from '../../../../infrastructure/persistence/sqlite/user-repository.js';
import { SqliteListRepository } from '../../../../infrastructure/persistence/sqlite/list-repository.js';
import { SqliteContactRepository } from '../../../../infrastructure/persistence/sqlite/contact-repository.js';
import { SqliteHistoryRepository } from '../../../../infrastructure/persistence/sqlite/history-repository.js';
import { SqliteJobRepository } from '../../../../infrastructure/persistence/sqlite/job-repository.js';
import { SqliteWebhookRepository } from '../../../../infrastructure/persistence/sqlite/webhook-repository.js';
import { SqliteAlertRepository } from '../../../../infrastructure/persistence/sqlite/alert-repository.js';
import { SqliteRevokedTokenRepository } from '../../../../infrastructure/persistence/sqlite/revoked-token-repository.js';

import { BcryptPasswordHasher } from '../../../../infrastructure/security/bcrypt-password-hasher.js';
import { JwtTokenService } from '../../../../infrastructure/security/jwt-token-service.js';
import { Sha256ApiKeyService } from '../../../../infrastructure/security/api-key-service.js';
import { SecretCipher, resolveKey } from '../../../../infrastructure/security/secret-crypto.js';

import { RegisterUser, LoginUser, RotateApiKey } from '../../../../application/auth-use-cases.js';
import { VerifySingleEmail } from '../../../../application/verify-use-cases.js';
import {
  UploadList, StartListVerification, GetListProgress, GetLists, GetListDetail,
  GetCleaningPlan, GetExportData, BulkDeleteByClassification, ScheduleReverification, DeleteList,
} from '../../../../application/list-use-cases.js';
import {
  ListWebhooks, AddWebhook, DeleteWebhook, TestWebhooks, ListAlerts, MarkAlertsRead,
} from '../../../../application/integration-use-cases.js';
import { parseUpload } from '../../../../infrastructure/parsing/file-parser.js';
import { AnalyzeListHealth, GetLatestListAnalysis } from '../../../../application/list-health-use-cases.js';
import { SqliteListAnalysisRepository } from '../../../../infrastructure/persistence/sqlite/list-analysis-repository.js';
import { VerificationQueue } from '../../../../infrastructure/jobs/verification-queue.js';
import { HttpWebhookSender } from '../../../../infrastructure/webhooks/http-webhook-sender.js';
import { summarize } from '../../../../domain/verification/health.js';
import { makeAuthMiddleware, makeCookieHelpers } from '../../middleware.js';

const SCHEMA = `
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  name TEXT, credits INTEGER NOT NULL DEFAULT 1000, plan TEXT NOT NULL DEFAULT 'free',
  api_key_hash TEXT, api_key_prefix TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE lists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, source TEXT, total INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE contacts (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email TEXT NOT NULL, score INTEGER, classification TEXT, status TEXT, signals TEXT, reasons TEXT,
  recommendation TEXT, greylisted INTEGER DEFAULT 0, provider TEXT, retry_after TEXT,
  deliverability TEXT, confidence TEXT, recommended_action TEXT, risk_signals TEXT,
  calibrated_confidence REAL, calibration_level TEXT, calibration_model TEXT,
  mailbox_status TEXT, verification_quality TEXT, smtp_evidence TEXT, acceptance_type TEXT, verified_at TEXT);
CREATE TABLE list_history (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  health REAL NOT NULL, metrics TEXT NOT NULL, counts TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE, type TEXT NOT NULL DEFAULT 'verify',
  status TEXT NOT NULL DEFAULT 'queued', total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE webhooks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL, event TEXT NOT NULL DEFAULT 'job.completed', secret TEXT, secret_enc TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id TEXT REFERENCES lists(id) ON DELETE CASCADE, level TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL, body TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE revoked_tokens (jti TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE list_analysis (list_id TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, health_score REAL NOT NULL,
  health_level TEXT NOT NULL, metrics TEXT NOT NULL, diagnosis TEXT, diagnosis_source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

const TEST_KEY_HEX = 'd'.repeat(64);

/**
 * @param {object} [opts]
 * @param {object} [opts.engine] injected verification engine (fake). Defaults to
 *   an UNKNOWN-returning engine so no network is touched.
 * @returns {{ app, db, url, listen, close, repos, services }}
 */
export function makeTestApp(opts = {}) {
  // Integration tests fire many auth/API requests against a single shared app.
  // Disable HTTP rate limiting for the test process. The production guard only
  // honors DISABLE_RATE_LIMIT outside production, so we must also ensure this
  // process is NOT seen as production (the workspace .env may set
  // NODE_ENV=production, which would otherwise force rate limiting back on).
  // Setting a test env here is legitimate and scoped to the test process.
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_RATE_LIMIT = 'true';

  const dbPath = path.join(os.tmpdir(), `mailhealth-http-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const users = new SqliteUserRepository(db);
  const lists = new SqliteListRepository(db);
  const contacts = new SqliteContactRepository(db);
  const history = new SqliteHistoryRepository(db);
  const jobs = new SqliteJobRepository(db);
  const cipher = new SecretCipher(resolveKey(TEST_KEY_HEX));
  const webhooksRepo = new SqliteWebhookRepository(db, cipher);
  const alerts = new SqliteAlertRepository(db);
  const revokedTokens = new SqliteRevokedTokenRepository(db);

  const passwordHasher = new BcryptPasswordHasher(6);
  const tokenService = new JwtTokenService('integration-test-secret-long-enough-1234567890');
  const apiKeyService = new Sha256ApiKeyService();
  const webhookSender = new HttpWebhookSender(webhooksRepo);

  // Deterministic engine: UNKNOWN unless a test injects its own.
  const verificationEngine = opts.engine || {
    verify: async (email) => ({
      email, score: 80, classification: 'unknown', status: 'unknown', signals: [], reasons: [],
      recommendation: 'REVERIFY', greylisted: false, provider: null, deliverability: 'unknown',
      confidence: 'low', recommendedAction: 'reverify', riskSignals: [], mailboxStatus: 'UNKNOWN',
      verificationQuality: 'LOW', verified_at: new Date().toISOString(),
    }),
    preResolveDomains: async () => {},
  };

  const queue = new VerificationQueue({
    jobRepository: jobs, listRepository: lists, contactRepository: contacts,
    historyRepository: history, alertRepository: alerts, verificationEngine,
    webhookSender, summarize, concurrency: 2,
  });
  // Do not auto-run jobs in tests unless asked; keep queue idle by default.
  queue.tick = async () => {};

  const useCases = {
    registerUser: new RegisterUser({ users, passwordHasher, tokenService, apiKeyService, signupCredits: 1000 }),
    loginUser: new LoginUser({ users, passwordHasher, tokenService }),
    rotateApiKey: new RotateApiKey({ users, apiKeyService }),
    verifySingleEmail: new VerifySingleEmail({ users, verificationEngine }),
    uploadList: new UploadList({ lists, contacts, parseUpload }),
    startListVerification: new StartListVerification({ lists, contacts, users, queue }),
    getListProgress: new GetListProgress({ lists, jobs }),
    getLists: new GetLists({ lists }),
    getListDetail: new GetListDetail({ lists, contacts, history, summarize }),
    getCleaningPlan: new GetCleaningPlan({ lists, contacts }),
    getExportData: new GetExportData({ lists, contacts }),
    bulkDeleteByClassification: new BulkDeleteByClassification({ lists, contacts }),
    scheduleReverification: new ScheduleReverification({ lists, schedules: { upsert() {} } }),
    deleteList: new DeleteList({ lists }),
    listWebhooks: new ListWebhooks({ webhooks: webhooksRepo }),
    addWebhook: new AddWebhook({ webhooks: webhooksRepo }),
    deleteWebhook: new DeleteWebhook({ webhooks: webhooksRepo }),
    testWebhooks: new TestWebhooks({ webhookSender }),
    listAlerts: new ListAlerts({ alerts }),
    markAlertsRead: new MarkAlertsRead({ alerts }),
    // Agent/AI endpoints are not exercised by these tests; provide stubs so
    // buildApp's router construction does not throw on missing deps.
    agentChat: { execute: async () => ({}) },
    agentHistory: { execute: () => ({}) },
    campaignPreflight: { execute: () => ({}) },
  };

  // AI List Health Analysis wired with a deterministic (no-model) AiProvider so
  // the route exercises the real code path with NO external LLM call.
  const listAnalysisRepo = new SqliteListAnalysisRepository(db);
  const noModelAi = opts.aiProvider || { isEnabled: () => true, hasModel: () => false, completeJson: async () => ({ ok: false }) };
  useCases.analyzeListHealth = new AnalyzeListHealth({ getListDetail: useCases.getListDetail, aiProvider: noModelAi, analysisRepository: listAnalysisRepo });
  useCases.getLatestListAnalysis = new GetLatestListAnalysis({ getListDetail: useCases.getListDetail, analysisRepository: listAnalysisRepo });

  const config = {
    ROOT: path.join(os.tmpdir(), 'mailhealth-test-root'),
    isProd: false, env: 'test', trustProxy: 0, corsOrigins: [], bodyLimit: '2mb',
    uploadLimitMb: 1, cookie: { secure: false, sameSite: 'lax' },
  };
  fs.mkdirSync(config.ROOT, { recursive: true });

  const authRequired = makeAuthMiddleware({ users, tokenService, apiKeyService, revokedTokens });
  const cookies = makeCookieHelpers(config);

  const verifyCapability = {
    liveSmtp: false, provider: 'none', realProvider: false, smtpMode: 'auto',
    smtpSource: 'none', workerConfigured: false, smtpDetail: 'test',
  };

  const container = {
    config, db, verifyCapability, calibrator: { status: () => ({ available: false }) },
    useCases, authRequired, cookies, tokenService, revokedTokens,
  };

  const app = buildApp(container);
  let server = null;

  return {
    app, db, container,
    repos: { users, lists, contacts, jobs, webhooksRepo, alerts, revokedTokens },
    services: { tokenService, apiKeyService, cipher, queue },
    async listen() {
      await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
      this.url = `http://127.0.0.1:${server.address().port}`;
      return this.url;
    },
    async close() {
      if (server) await new Promise((r) => server.close(r));
      try { db.close(); } catch { /* ignore */ }
      for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ } }
    },
  };
}

// Convenience: register a user through the HTTP API and return { token, apiKey, user }.
export async function registerViaApi(url, email = 'user@example.com', password = 'password1') {
  const res = await fetch(url + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { status: res.status, ...body };
}
