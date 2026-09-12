import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  authRequired,
  publicUser,
  generateApiKey,
  setAuthCookie,
  clearAuthCookie,
} from '../auth.js';
import { asyncHandler, isEmail } from '../middleware.js';

const router = express.Router();

// Password policy: at least 8 chars, with a letter and a number.
function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Password must be at least 8 characters';
  if (s.length > 200) return 'Password is too long';
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) {
    return 'Password must contain at least one letter and one number';
  }
  return null;
}

router.post('/register', asyncHandler((req, res) => {
  const { email, password, name } = req.body || {};
  const normEmail = String(email || '').trim().toLowerCase();
  if (!isEmail(normEmail)) return res.status(400).json({ error: 'A valid email is required' });
  const pwErr = passwordProblem(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const key = generateApiKey();
  const user = {
    id: nanoid(),
    email: normEmail,
    password_hash: hashPassword(String(password)),
    name: (name ? String(name).slice(0, 100) : normEmail.split('@')[0]),
    credits: config.signupCredits,
    plan: 'free',
    api_key_hash: key.hash,
    api_key_prefix: key.prefix,
  };
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, credits, plan, api_key_hash, api_key_prefix)
     VALUES (@id, @email, @password_hash, @name, @credits, @plan, @api_key_hash, @api_key_prefix)`
  ).run(user);

  const token = signToken(user);
  setAuthCookie(res, token);
  // Return the plaintext API key exactly once, at creation.
  res.json({ token, user: publicUser(user), apiKey: key.raw });
}));

router.post('/login', asyncHandler((req, res) => {
  const { email, password } = req.body || {};
  const normEmail = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
  // Constant-ish work whether or not the user exists (verifyPassword runs).
  const ok = user && verifyPassword(String(password || ''), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Regenerate API key. Returns the new plaintext key once.
router.post('/api-key/rotate', authRequired, (req, res) => {
  const key = generateApiKey();
  db.prepare('UPDATE users SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?')
    .run(key.hash, key.prefix, req.user.id);
  res.json({ apiKey: key.raw, apiKeyPrefix: key.prefix });
});

export default router;
