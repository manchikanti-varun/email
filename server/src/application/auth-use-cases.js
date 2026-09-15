// Authentication use cases. Each orchestrates domain rules + injected ports;
// no HTTP, no SQL. Errors are thrown as AppError with an HTTP-ish status so the
// interface layer can translate them uniformly.
import { nanoid } from 'nanoid';
import { AppError } from './errors.js';
import { toPublicUser } from '../domain/entities/user.js';

// Stricter than RFC 5322 but rejects common invalid patterns: consecutive dots,
// leading/trailing dots in local part, missing TLD, etc.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
function isEmail(v) {
  if (typeof v !== 'string' || v.length > 254 || v.length < 3) return false;
  if (!EMAIL_RE.test(v)) return false;
  // Additional: reject consecutive dots in local part (a..b@c.com)
  const local = v.split('@')[0];
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return true;
}

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

export class RegisterUser {
  constructor({ users, passwordHasher, tokenService, apiKeyService, signupCredits }) {
    this.users = users;
    this.hasher = passwordHasher;
    this.tokens = tokenService;
    this.apiKeys = apiKeyService;
    this.signupCredits = signupCredits;
  }

  execute({ email, password, name }) {
    const normEmail = String(email || '').trim().toLowerCase();
    if (!isEmail(normEmail)) throw new AppError(400, 'A valid email is required');
    const pwErr = passwordProblem(password);
    if (pwErr) throw new AppError(400, pwErr);

    if (this.users.findByEmail(normEmail)) {
      throw new AppError(409, 'An account with that email already exists');
    }

    const key = this.apiKeys.generate();
    const user = {
      id: nanoid(),
      email: normEmail,
      password_hash: this.hasher.hash(String(password)),
      name: name ? String(name).slice(0, 100) : normEmail.split('@')[0],
      credits: this.signupCredits,
      plan: 'free',
      api_key_hash: key.hash,
      api_key_prefix: key.prefix,
    };
    this.users.create(user);

    const token = this.tokens.sign(user);
    // apiKey (plaintext) is returned exactly once, at creation.
    return { token, user: toPublicUser(user), apiKey: key.raw };
  }
}

export class LoginUser {
  constructor({ users, passwordHasher, tokenService }) {
    this.users = users;
    this.hasher = passwordHasher;
    this.tokens = tokenService;
  }

  execute({ email, password }) {
    const normEmail = String(email || '').trim().toLowerCase();
    const user = this.users.findByEmail(normEmail);
    const ok = user && this.hasher.verify(String(password || ''), user.password_hash);
    if (!ok) throw new AppError(401, 'Invalid email or password');
    const token = this.tokens.sign(user);
    return { token, user: toPublicUser(user) };
  }
}

export class RotateApiKey {
  constructor({ users, apiKeyService }) {
    this.users = users;
    this.apiKeys = apiKeyService;
  }

  execute(userId) {
    const key = this.apiKeys.generate();
    this.users.setApiKey(userId, key.hash, key.prefix);
    return { apiKey: key.raw, apiKeyPrefix: key.prefix };
  }
}
