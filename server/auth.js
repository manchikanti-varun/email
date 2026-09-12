// Authentication helpers + Express middleware.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

// bcrypt cost factor: 12 is a reasonable production default.
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, BCRYPT_ROUNDS);
}
export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' });
}

// ---- API keys --------------------------------------------------------------
// The plaintext key is shown to the user exactly once; only a SHA-256 hash is
// stored. Lookups hash the incoming key and compare. Prefix is kept in the
// clear so keys can be displayed as elh_ABCD…(hidden).
export function generateApiKey() {
  const raw = 'elh_' + crypto.randomBytes(24).toString('base64url');
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) };
}
export function hashApiKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---- Cookie helper ---------------------------------------------------------
export function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}
export function clearAuthCookie(res) {
  res.clearCookie('token', { path: '/' });
}

function userFromToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) || null;
  } catch {
    return null;
  }
}

// Accepts either a Bearer JWT / cookie (dashboard) or an X-API-Key header (API).
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = req.cookies?.token || null;
  const apiKey = req.headers['x-api-key'] || null;

  let user = null;
  if (bearer) user = userFromToken(bearer);
  else if (cookieToken) user = userFromToken(cookieToken);
  else if (apiKey) {
    user = db.prepare('SELECT * FROM users WHERE api_key_hash = ?').get(hashApiKey(apiKey)) || null;
  }

  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  req.authMethod = apiKey && !bearer && !cookieToken ? 'api_key' : 'session';
  next();
}

// Deducts credits atomically; returns false if insufficient.
export function chargeCredits(userId, amount) {
  const info = db
    .prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?')
    .run(amount, userId, amount);
  return info.changes > 0;
}

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    credits: u.credits,
    plan: u.plan,
    apiKeyPrefix: u.api_key_prefix || null,
    createdAt: u.created_at,
  };
}
