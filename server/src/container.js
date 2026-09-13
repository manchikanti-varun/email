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

// Infrastructure — verification gateways
import { NodeDnsResolver } from './infrastructure/verification/node-dns-resolver.js';
import { SocketSmtpProbe } from './infrastructure/verification/socket-smtp-probe.js';
import { selectProvider } from './infrastructure/verification/providers.js';
import { loadFeeds } from './infrastructure/verification/feed-loader.js';

// Infrastructure — security, webhooks, jobs, parsing
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password-hasher.js';
import { JwtTokenService } from './infrastructure/security/jwt-token-service.js';
import { Sha256ApiKeyService } from './infrastructure/security/api-key-service.js';
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

  // --- Verification gateways + engine ------------------------------------
  const referenceData = new ReferenceData();
  const dnsResolver = new NodeDnsResolver();
  const smtpProbe = new SocketSmtpProbe(config.smtp);
  const provider = selectProvider(process.env);
  const verificationEngine = new VerificationEngine({
    dnsResolver, smtpProbe, getProvider: () => provider, referenceData,
  });

  // --- Security services --------------------------------------------------
  const passwordHasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService(config.jwtSecret);
  const apiKeyService = new Sha256ApiKeyService();

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
    concurrency: config.verifyConcurrency,
  });
  const scheduler = new Scheduler({
    scheduleRepository: schedules,
    listRepository: lists,
    contactRepository: contacts,
    queue,
  });

  // --- Application use cases ----------------------------------------------
  const useCases = {
    registerUser: new RegisterUser({ users, passwordHasher, tokenService, apiKeyService, signupCredits: config.signupCredits }),
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
    scheduleReverification: new ScheduleReverification({ lists, schedules }),
    deleteList: new DeleteList({ lists }),

    campaignPreflight: new CampaignPreflight({ lists, contacts }),

    listWebhooks: new ListWebhooks({ webhooks: webhooksRepo }),
    addWebhook: new AddWebhook({ webhooks: webhooksRepo }),
    deleteWebhook: new DeleteWebhook({ webhooks: webhooksRepo }),
    testWebhooks: new TestWebhooks({ webhookSender }),
    listAlerts: new ListAlerts({ alerts }),
    markAlertsRead: new MarkAlertsRead({ alerts }),
  };

  // --- Interface glue -----------------------------------------------------
  const authRequired = makeAuthMiddleware({ users, tokenService, apiKeyService });
  const cookies = makeCookieHelpers(config);

  // Verification capability, filled in at boot by the SMTP self-test.
  const verifyCapability = {
    liveSmtp: null,
    smtpDetail: 'checking…',
    provider: provider.name,
    realProvider: provider.name !== 'none',
  };

  return {
    config,
    db,
    closeDb,
    referenceData,
    smtpProbe,
    queue,
    scheduler,
    verifyCapability,
    useCases,
    authRequired,
    cookies,
    // convenience for boot logging
    providerName: provider.name,
  };
}
