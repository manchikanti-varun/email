// Shared Express middleware: logging, error handling, async wrapping,
// rate limiting, and input validation. Kept dependency-light.
import rateLimit from 'express-rate-limit';
import { config } from './config.js';

// ---- Request logging -------------------------------------------------------
// Compact structured line per request. Avoids logging bodies (may hold PII).
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    // Skip noisy static asset logs in production.
    if (config.isProd && !req.path.startsWith('/api/')) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      m: req.method,
      p: req.originalUrl.split('?')[0],
      s: res.statusCode,
      ms,
      ip: req.ip,
    });
    if (res.statusCode >= 500) console.error(line);
    else console.log(line);
  });
  next();
}

// ---- Async route wrapper ---------------------------------------------------
// Wrap async handlers so rejected promises reach the error handler instead of
// hanging the request.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ---- Rate limiters ---------------------------------------------------------
const rlOpts = (windowMs, max, message) => ({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
  // Skip limiting in tests / when explicitly disabled.
  skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
});

// Broad limiter for the whole API.
export const apiLimiter = rateLimit(
  rlOpts(15 * 60 * 1000, parseInt(process.env.RL_API_MAX || '600', 10),
    'Too many requests, please slow down.')
);

// Strict limiter for auth endpoints to blunt brute-force / credential stuffing.
export const authLimiter = rateLimit(
  rlOpts(15 * 60 * 1000, parseInt(process.env.RL_AUTH_MAX || '20', 10),
    'Too many attempts. Try again in a few minutes.')
);

// Verification endpoints are credit-gated already, but cap request rate too.
export const verifyLimiter = rateLimit(
  rlOpts(60 * 1000, parseInt(process.env.RL_VERIFY_MAX || '120', 10),
    'Verification rate limit reached, please retry shortly.')
);

// ---- Validation helpers ----------------------------------------------------
export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body[f] === null || body[f] === '');
  return missing;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(v) { return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v); }

// ---- 404 + error handler ---------------------------------------------------
export function notFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile('index.html', { root: 'public' });
}

// Centralized error handler: never leak stack traces to clients in production.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  // Multer file-size and known client errors carry helpful messages.
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
  res.status(status).json({ error: clientMessage });
}
