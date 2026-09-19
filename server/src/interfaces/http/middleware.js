// Express middleware: async wrapping, logging, rate limiting, validation,
// error handling, and the SPA fallback. HTTP concerns only.
import rateLimit from 'express-rate-limit';
import { AppError } from '../../application/errors.js';

// Wrap async handlers so rejected promises reach the error handler.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ---- Request logging -------------------------------------------------------
// Sanitize strings before inserting into log lines to prevent log forging/injection.
// Control chars (newlines, tabs) can forge log entries or inject ANSI escape codes.
function sanitizeLogStr(s) {
  return String(s || '').replace(/[\r\n\x00-\x1f\x7f]/g, '_').slice(0, 500);
}

export function makeRequestLogger(config) {
  return function requestLogger(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (config.isProd && !req.path.startsWith('/api/')) return;
      const line = JSON.stringify({
        t: new Date().toISOString(), m: req.method,
        p: sanitizeLogStr(req.originalUrl.split('?')[0]),
        s: res.statusCode, ms,
        ip: sanitizeLogStr(req.ip),
      });
      if (res.statusCode >= 500) console.error(line);
      else console.log(line);
    });
    next();
  };
}

// ---- Rate limiters ---------------------------------------------------------
// Rate limiting may be disabled ONLY outside production. In production the
// DISABLE_RATE_LIMIT flag is ignored here (fail closed) — and config.js also
// refuses to start when it is set — so production can never silently run with
// rate limiting off. `rateLimitingDisabled()` is the single source of truth.
export function rateLimitingDisabled() {
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  return !isProd && process.env.DISABLE_RATE_LIMIT === 'true';
}

const rlOpts = (windowMs, max, message) => ({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  message: { error: message },
  skip: () => rateLimitingDisabled(),
});

export const apiLimiter = rateLimit(
  rlOpts(15 * 60 * 1000, parseInt(process.env.RL_API_MAX || '600', 10),
    'Too many requests, please slow down.')
);
export const authLimiter = rateLimit(
  rlOpts(15 * 60 * 1000, parseInt(process.env.RL_AUTH_MAX || '20', 10),
    'Too many attempts. Try again in a few minutes.')
);
export const verifyLimiter = rateLimit(
  rlOpts(60 * 1000, parseInt(process.env.RL_VERIFY_MAX || '120', 10),
    'Verification rate limit reached, please retry shortly.')
);

// ---- Auth middleware -------------------------------------------------------
// Accepts a Bearer JWT / cookie (dashboard) or an X-API-Key header (API).
//
// `revokedTokens` is an OPTIONAL RevokedTokenRepository. When present, a token
// whose `jti` has been revoked (logout) is rejected. Revocation-store lookups
// FAIL CLOSED: if the store throws, the request is rejected rather than
// silently accepted, so a store outage cannot resurrect revoked tokens.
export function makeAuthMiddleware({ users, tokenService, apiKeyService, revokedTokens = null }) {
  // Returns { user, jti } for a valid, non-revoked token; throws { revoked:true }
  // when the token is revoked or the revocation store fails (fail closed);
  // returns null for an invalid/expired/malformed token.
  function resolveToken(token) {
    const detail = typeof tokenService.verifyDetailed === 'function'
      ? tokenService.verifyDetailed(token)
      : (() => { const id = tokenService.verify(token); return id ? { userId: id, jti: null } : null; })();
    if (!detail) return null;
    if (revokedTokens && detail.jti) {
      let revoked;
      try {
        revoked = revokedTokens.isRevoked(detail.jti);
      } catch {
        // Fail closed: cannot prove the token is still valid.
        const e = new Error('revocation_check_failed');
        e.failClosed = true;
        throw e;
      }
      if (revoked) {
        const e = new Error('token_revoked');
        e.failClosed = true;
        throw e;
      }
    }
    const user = detail.userId ? users.findById(detail.userId) : null;
    return user ? { user, jti: detail.jti } : null;
  }

  return function authRequired(req, res, next) {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const cookieToken = req.cookies?.token || null;
    const apiKey = req.headers['x-api-key'] || null;

    let resolved = null;
    try {
      if (bearer) resolved = resolveToken(bearer);
      else if (cookieToken) resolved = resolveToken(cookieToken);
      else if (apiKey) {
        const user = users.findByApiKeyHash(apiKeyService.hash(apiKey));
        if (user) resolved = { user, jti: null };
      }
    } catch (e) {
      // Revoked token or revocation-store failure -> fail closed.
      if (e && e.failClosed) return res.status(401).json({ error: 'Unauthorized' });
      throw e;
    }

    if (!resolved || !resolved.user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = resolved.user;
    // Expose the token id + raw token so the logout handler can revoke it.
    req.tokenId = resolved.jti || null;
    req.bearerOrCookieToken = bearer || cookieToken || null;
    req.authMethod = apiKey && !bearer && !cookieToken ? 'api_key' : 'session';
    next();
  };
}

// ---- Cookie helpers --------------------------------------------------------
export function makeCookieHelpers(config) {
  return {
    setAuthCookie(res, token) {
      res.cookie('token', token, {
        httpOnly: true,
        secure: config.cookie.secure,
        sameSite: config.cookie.sameSite,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    },
    clearAuthCookie(res) {
      res.clearCookie('token', { path: '/' });
    },
  };
}

// ---- 404 + error handler ---------------------------------------------------
export function makeNotFound(publicDir) {
  return function notFound(req, res) {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.status(404).sendFile('index.html', { root: publicDir });
  };
}

export function makeErrorHandler(config) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    const clientMessage =
      status < 500 ? (err.message || 'Request error') :
      (config.isProd ? 'Internal server error' : (err.message || 'Internal server error'));

    if (status >= 500) {
      console.error(JSON.stringify({
        t: new Date().toISOString(), level: 'error',
        p: req.originalUrl, msg: err.message, stack: err.stack,
      }));
    }
    if (res.headersSent) return next(err);

    // AppError may carry extra fields (e.g. `needed` on 402).
    const body = { error: clientMessage };
    if (err instanceof AppError && typeof err.needed === 'number') body.needed = err.needed;
    res.status(status).json(body);
  };
}
