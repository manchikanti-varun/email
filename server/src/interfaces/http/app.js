// Builds the Express application from a wired container. This is the HTTP
// composition — security middleware, health/readiness, API routers, static
// SPA hosting, and error handling. It contains no business logic.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';

import {
  makeRequestLogger, makeErrorHandler, makeNotFound,
  apiLimiter, authLimiter, verifyLimiter,
} from './middleware.js';
import { makeAuthRouter } from './routes/auth-routes.js';
import { makeVerifyRouter } from './routes/verify-routes.js';
import { makeListRouter } from './routes/list-routes.js';
import { makeCampaignRouter } from './routes/campaign-routes.js';
import { makeIntegrationRouter } from './routes/integration-routes.js';
import { makeAgentRouter } from './routes/agent-routes.js';
import { makeAiRouter } from './routes/ai-routes.js';

export function buildApp(container) {
  const { config, db, verifyCapability, calibrator, useCases, authRequired, cookies } = container;
  const publicDir = path.join(config.ROOT, 'public');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Skip gzip for NDJSON upload progress streams so stage events flush promptly.
  app.use(compression({
    filter: (req, res) => {
      if (req.query?.progress === '1') return false;
      if ((req.headers.accept || '').includes('application/x-ndjson')) return false;
      return compression.filter(req, res);
    },
  }));
  app.use(makeRequestLogger(config));

  app.use(cors({
    origin: config.isProd
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          cb(null, config.corsOrigins.includes(origin));
        }
      : true,
    credentials: true,
  }));

  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  // ---- Health / readiness ----
  app.get('/api/health', (req, res) =>
    res.json({
      ok: true,
      service: 'email-list-health',
      env: config.env,
      verification: {
        liveSmtp: verifyCapability.liveSmtp,
        provider: verifyCapability.provider,
        realProvider: verifyCapability.realProvider,
        smtpMode: verifyCapability.smtpMode,
        smtpSource: verifyCapability.smtpSource,
        workerConfigured: verifyCapability.workerConfigured,
        mode: verifyCapability.smtpSource === 'smtp-worker'
          ? 'smtp-worker'
          : (verifyCapability.liveSmtp
            ? 'live-smtp'
            : (verifyCapability.realProvider ? 'external-provider' : 'local-only')),
        detail: verifyCapability.smtpDetail,
      },
    }));

  app.get('/api/ready', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false, error: 'database unavailable' });
    }
  });

  // ---- API routes (rate limited) ----
  app.use('/api/', apiLimiter);
  app.use('/api/auth', authLimiter, makeAuthRouter({ ...useCases, authRequired, cookies }));
  app.use('/api/verify', verifyLimiter, makeVerifyRouter({ ...useCases, authRequired }));
  app.use('/api/lists', makeListRouter({ ...useCases, authRequired, uploadLimitMb: config.uploadLimitMb }));
  app.use('/api/campaigns', makeCampaignRouter({ ...useCases, authRequired }));
  app.use('/api/integrations', makeIntegrationRouter({ ...useCases, authRequired }));
  app.use('/api/agent', makeAgentRouter({ ...useCases, authRequired }));
  app.use('/api/ai', makeAiRouter({ ...useCases, authRequired, calibrator }));

  // ---- Static frontend ----
  app.use(express.static(publicDir, {
    maxAge: config.isProd ? '1h' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use(makeNotFound(publicDir));
  app.use(makeErrorHandler(config));

  return app;
}
