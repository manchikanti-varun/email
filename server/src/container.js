// Composition root. Instantiates every infrastructure adapter, injects them
// into the domain services and application use cases, and returns a fully
// wired container. This is the ONLY place that knows about concrete classes;
// every other module depends on abstractions.
import { config as baseConfig, ROOT } from '../config.js';

// Infrastructure — persistence
import { db, closeDb } from './infrastructure/persistence/sqlite/connection.js';
import { SqliteUserRepository } from './infrastructure/persistence/sqlite/user-repository.js';
import { SqliteListRepository } from './infrastructure/persistence/sqlite/list-repository.js';
import { SqliteContactRepository } from './infrastructure/persistence/sqlite/contact-repository.js';
import { SqliteHistoryRepository } from './infrastructure/persistence/sqlite/history-repository.js';
import { SqliteJobRepository } from './infrastructure/persistence/sqlite/job-repository.js';
import { SqliteWebhookRepository } from './infrastructure/persistence/sqlite/webhook-repository.js';
import { SqliteAlertRepository } from './infrastructure/persistence/sqlite/alert-repository.js';
import { SqliteScheduleRepository } from './infrastructure/persistence/sqlite/schedule-repository.js';
import { SqliteAgentAuditRepository } from './infrastructure/persistence/sqlite/agent-audit-repository.js';
import { SqliteRevokedTokenRepository } from './infrastructure/persistence/sqlite/revoked-token-repository.js';
import { SqliteListAnalysisRepository } from './infrastructure/persistence/sqlite/list-analysis-repository.js';

// Infrastructure — verification gateways
import { NodeDnsResolver } from './infrastructure/verification/node-dns-resolver.js';
import { SocketSmtpProbe } from './infrastructure/verification/socket-smtp-probe.js';
import { RemoteSmtpProbe } from './infrastructure/verification/remote-smtp-probe.js';
import { SmtpRouter } from './infrastructure/verification/smtp-router.js';
import { selectProvider } from './infrastructure/verification/providers.js';
import { loadFeeds } from './infrastructure/verification/feed-loader.js';

// Infrastructure — security, webhooks, jobs, parsing
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password-hasher.js';
import { JwtTokenService } from './infrastructure/security/jwt-token-service.js';
import { Sha256ApiKeyService } from './infrastructure/security/api-key-service.js';
import { createSecretCipher } from './infrastructure/security/secret-crypto.js';
import { HttpWebhookSender } from './infrastructure/webhooks/http-webhook-sender.js';
import { VerificationQueue } from './infrastructure/jobs/verification-queue.js';
import { Scheduler } from './infrastructure/jobs/scheduler.js';
import { parseUpload } from './infrastructure/parsing/file-parser.js';

// Domain
import { VerificationEngine } from './domain/verification/engine.js';
import { ReferenceData } from './domain/verification/reference-data.js';
import { summarize } from './domain/verification/health.js';

// Application use cases
import { RegisterUser, LoginUser, RotateApiKey } from './application/auth-use-cases.js';
import { VerifySingleEmail } from './application/verify-use-cases.js';
import {
  UploadList, StartListVerification, GetListProgress, GetLists, GetListDetail,
  GetCleaningPlan, GetExportData, BulkDeleteByClassification, ScheduleReverification, DeleteList,
} from './application/list-use-cases.js';
import { CampaignPreflight } from './application/campaign-use-cases.js';
import {
  ListWebhooks, AddWebhook, DeleteWebhook, TestWebhooks, ListAlerts, MarkAlertsRead,
} from './application/integration-use-cases.js';
import {
  GetAccountCredits, GetListSummary, GetFilteredContacts, EstimateVerificationCost,
} from './application/agent-support-use-cases.js';
import { AgentChat, AgentHistory } from './application/agent-use-cases.js';
import {
  GetCampaignRisk, GetHealthAnalysis, GetHealthPrediction, GetListAnomalies,
  GetDomainIntelligence, GetSmartCleaning, GetReverificationPriority,
  GetCreditOptimization, GetEmailExplanation, GetBusinessInsights,
  InvestigateVerification, DetectIncidents, AnalyzeBenchmark,
  CalibrateVerificationConfidence, CalibrateSingleResult,
  GetCalibrationBenchmark, GetCalibrationDrift,
} from './application/ai-use-cases.js';
import { AnalyzeListHealth, GetLatestListAnalysis } from './application/list-health-use-cases.js';

// ML Confidence Calibration layer (additive; downstream of the deterministic
// engine). Loads a trained model artifact; falls back safely when unavailable.
import { ConfidenceCalibrator, loadModel } from '../agent/intelligence/calibration/index.js';

// AI agent runtime (optional intelligence/orchestration layer)
import { AiProvider } from '../agent/provider.js';
import { registry as toolRegistry } from '../agent/tools.js';
import { MailHealthAgent } from '../agent/agent.js';

// Interface glue
import { makeAuthMiddleware, makeCookieHelpers } from './interfaces/http/middleware.js';

export function createContainer() {
  // Make ROOT available on config for the HTTP layer's static hosting.
  const config = { ...baseConfig, ROOT };

  // --- Repositories -------------------------------------------------------
  const users = new SqliteUserRepository(db);
  const lists = new SqliteListRepository(db);
  const contacts = new SqliteContactRepository(db);
  const history = new SqliteHistoryRepository(db);
  const jobs = new SqliteJobRepository(db);
  const webhooksRepo = new SqliteWebhookRepository(db);
  const alerts = new SqliteAlertRepository(db);
  const schedules = new SqliteScheduleRepository(db);
  const agentAudit = new SqliteAgentAuditRepository(db);
  const revokedTokens = new SqliteRevokedTokenRepository(db);
  const listAnalysis = new SqliteListAnalysisRepository(db);

  // --- Verification gateways + engine ------------------------------------
  const referenceData = new ReferenceData();
  const dnsResolver = new NodeDnsResolver();

  // SMTP capability is a ROUTER over two adapters: a local socket probe (needs
  // outbound port 25 on this host) and a remote MailHealth SMTP worker (runs
  // where port 25 is open). The engine only sees the router. This is what lets
  // the main app run on hosts that block port 25 without any third-party API.
  const localSmtpProbe = new SocketSmtpProbe({
    enabled: config.smtp.enabled,
    from: config.smtp.from,
    timeoutMs: config.smtp.timeoutMs,
    maxRetries: config.smtp.maxRetries,
    domainMinIntervalMs: config.smtp.domainMinIntervalMs,
    cacheTtlMs: config.smtp.cacheTtlMs,
  });
  const remoteSmtpProbe = new RemoteSmtpProbe({
    url: config.smtpWorker.url,
    secret: config.smtpWorker.secret,
    timeoutMs: config.smtpWorker.timeoutMs,
    maxRetries: config.smtpWorker.maxRetries,
    from: config.smtp.from,
  });
  const smtpProbe = new SmtpRouter({
    mode: config.smtp.enabled ? config.smtp.mode : 'disabled',
    local: localSmtpProbe,
    remote: remoteSmtpProbe,
    log: (m) => { if (!config.isProd) console.log(JSON.stringify({ t: new Date().toISOString(), scope: 'smtp-router', ...m })); },
  });

  const provider = selectProvider(process.env);
  const verificationEngine = new VerificationEngine({
    dnsResolver, smtpProbe, getProvider: () => provider, referenceData,
  });

  // --- ML Confidence Calibration -----------------------------------------
  // Loads the shipped model artifact (or an honest "untrained" placeholder).
  // The calibrator is DOWNSTREAM of the engine and never alters verdicts; when
  // the model is unavailable it reports the deterministic confidence. Any
  // load/inference failure degrades gracefully to the deterministic path.
  const calibrationModel = loadModel();
  const calibrator = new ConfidenceCalibrator({
    model: calibrationModel,
    minPerformance: config.ai?.calibrationMinAccuracy ?? 0,
  });

  // --- Security services --------------------------------------------------
  const passwordHasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService(config.jwtSecret);
  const apiKeyService = new Sha256ApiKeyService();

  // Webhook secret encryption-at-rest (H2). Explicit key in prod; a derived
  // dev key (from JWT_SECRET) locally. createSecretCipher throws in prod when
  // no key is configured — but assertProductionConfig already fails fast first.
  const secretCipher = createSecretCipher({
    key: config.webhookEncryptionKey,
    devFallbackPassphrase: config.jwtSecret,
    isProd: config.isProd,
  });
  // Re-bind the webhook repository with the cipher, then migrate any leftover
  // plaintext secrets to encrypted-at-rest (idempotent).
  webhooksRepo.cipher = secretCipher;
  try {
    const migrated = webhooksRepo.migratePlaintextSecrets();
    if (migrated > 0) console.log(`  Encrypted ${migrated} plaintext webhook secret(s) at rest`);
  } catch (e) {
    console.error('  Webhook secret migration skipped:', e.message);
  }

  // --- Webhooks, queue, scheduler ----------------------------------------
  const webhookSender = new HttpWebhookSender(webhooksRepo);
  const queue = new VerificationQueue({
    jobRepository: jobs,
    listRepository: lists,
    contactRepository: contacts,
    historyRepository: history,
    alertRepository: alerts,
    verificationEngine,
    webhookSender,
    summarize,
    calibrator,
    concurrency: config.verifyConcurrency,
  });
  const scheduler = new Scheduler({
    scheduleRepository: schedules,
    listRepository: lists,
    contactRepository: contacts,
    queue,
    revokedTokenRepository: revokedTokens,
  });

  // --- Application use cases ----------------------------------------------
  const useCases = {
    registerUser: new RegisterUser({ users, passwordHasher, tokenService, apiKeyService, signupCredits: config.signupCredits }),
    loginUser: new LoginUser({ users, passwordHasher, tokenService }),
    rotateApiKey: new RotateApiKey({ users, apiKeyService }),

    verifySingleEmail: new VerifySingleEmail({ users, verificationEngine, calibrator }),

    uploadList: new UploadList({ lists, contacts, parseUpload }),
    startListVerification: new StartListVerification({ lists, contacts, users, queue }),
    getListProgress: new GetListProgress({ lists, jobs }),
    getLists: new GetLists({ lists }),
    getListDetail: new GetListDetail({ lists, contacts, history, summarize }),
    getCleaningPlan: new GetCleaningPlan({ lists, contacts }),
    getExportData: new GetExportData({ lists, contacts }),
    bulkDeleteByClassification: new BulkDeleteByClassification({ lists, contacts }),
    scheduleReverification: new ScheduleReverification({ lists, schedules }),
    deleteList: new DeleteList({ lists }),

    campaignPreflight: new CampaignPreflight({ lists, contacts }),

    // Agent-support reads (reuse existing repos; no verification logic here)
    getAccountCredits: new GetAccountCredits({ users }),
    getListSummary: new GetListSummary({ lists }),
    getFilteredContacts: new GetFilteredContacts({ lists, contacts }),
    estimateVerificationCost: new EstimateVerificationCost({ lists, contacts, users }),

    listWebhooks: new ListWebhooks({ webhooks: webhooksRepo }),
    addWebhook: new AddWebhook({ webhooks: webhooksRepo }),
    deleteWebhook: new DeleteWebhook({ webhooks: webhooksRepo }),
    testWebhooks: new TestWebhooks({ webhookSender }),
    listAlerts: new ListAlerts({ alerts }),
    markAlertsRead: new MarkAlertsRead({ alerts }),
  };

  // --- AI Agent (optional) ------------------------------------------------
  // The agent orchestrates the EXISTING use-cases above; it never re-implements
  // verification. The tool context exposes the wired use-cases and the current
  // user id. Everything is off unless config.ai.enabled is true.
  const aiProvider = new AiProvider(config.ai);
  const agent = new MailHealthAgent({
    config,
    provider: aiProvider,
    registry: toolRegistry,
    audit: agentAudit,
    // Factory: per-request tool execution context bound to the current user.
    toolContextFactory: (user) => ({ userId: user.id, useCases, config: { ...config, calibrationStatus: calibrator.status() } }),
  });
  useCases.agentChat = new AgentChat({ agent });
  useCases.agentHistory = new AgentHistory({ audit: agentAudit });

  // --- Interface glue -----------------------------------------------------
  const authRequired = makeAuthMiddleware({ users, tokenService, apiKeyService, revokedTokens });
  const cookies = makeCookieHelpers(config);

  // Verification capability, filled in at boot by the SMTP self-test.
  const verifyCapability = {
    liveSmtp: null,
    smtpDetail: 'checking…',
    smtpMode: config.smtp.enabled ? config.smtp.mode : 'disabled',
    smtpSource: null,               // 'local-smtp' | 'smtp-worker' | 'none'
    workerConfigured: !!config.smtpWorker.url,
    provider: provider.name,
    realProvider: provider.name !== 'none',
  };

  // --- AI Intelligence Layer use cases ------------------------------------
  // Additive analysis on top of the deterministic engine. Each fetches real
  // data via the existing use-cases above (ownership enforced) and delegates
  // interpretation to the pure intelligence modules. No LLM required; the
  // agent may narrate these results when a model is configured.
  Object.assign(useCases, {
    aiCampaignRisk: new GetCampaignRisk({ getListDetail: useCases.getListDetail, campaignPreflight: useCases.campaignPreflight }),
    aiHealthAnalysis: new GetHealthAnalysis({ getListDetail: useCases.getListDetail }),
    aiHealthPrediction: new GetHealthPrediction({ getListDetail: useCases.getListDetail }),
    aiListAnomalies: new GetListAnomalies({ getListDetail: useCases.getListDetail }),
    aiDomainIntelligence: new GetDomainIntelligence({ getListDetail: useCases.getListDetail }),
    aiSmartCleaning: new GetSmartCleaning({ getListDetail: useCases.getListDetail, getCleaningPlan: useCases.getCleaningPlan }),
    aiReverificationPriority: new GetReverificationPriority({ getListDetail: useCases.getListDetail }),
    aiCreditOptimization: new GetCreditOptimization({ getListDetail: useCases.getListDetail, getAccountCredits: useCases.getAccountCredits }),
    aiEmailExplanation: new GetEmailExplanation({ getListDetail: useCases.getListDetail }),
    aiBusinessInsights: new GetBusinessInsights({ getListDetail: useCases.getListDetail }),
    aiInvestigate: new InvestigateVerification({ getListDetail: useCases.getListDetail, verifyCapability }),
    aiIncidents: new DetectIncidents({ getListDetail: useCases.getListDetail, getLists: useCases.getLists, verifyCapability }),
    aiBenchmarkAnalysis: new AnalyzeBenchmark(),
    // ML Confidence Calibration use-cases (additive; verdict-preserving).
    aiConfidenceCalibration: new CalibrateVerificationConfidence({ getListDetail: useCases.getListDetail, calibrator }),
    aiCalibrateResult: new CalibrateSingleResult({ calibrator }),
    aiCalibrationBenchmark: new GetCalibrationBenchmark(),
    aiCalibrationDrift: new GetCalibrationDrift(),
    // AI List Health Analysis & Diagnosis (deterministic report + one
    // fail-safe list-level LLM diagnosis). Persists the latest analysis.
    analyzeListHealth: new AnalyzeListHealth({
      getListDetail: useCases.getListDetail, aiProvider, analysisRepository: listAnalysis,
    }),
    getLatestListAnalysis: new GetLatestListAnalysis({
      getListDetail: useCases.getListDetail, analysisRepository: listAnalysis,
    }),
  });

  return {
    config,
    db,
    closeDb,
    referenceData,
    smtpProbe,
    queue,
    scheduler,
    verifyCapability,
    calibrator,
    calibrationStatus: calibrator.status(),
    useCases,
    authRequired,
    cookies,
    tokenService,
    revokedTokens,
    agent,
    // convenience for boot logging
    providerName: provider.name,
    aiEnabled: !!config.ai.enabled,
    aiMode: aiProvider.hasModel() ? `llm:${config.ai.provider}/${config.ai.model}` : (config.ai.enabled ? 'heuristic' : 'disabled'),
  };
}
