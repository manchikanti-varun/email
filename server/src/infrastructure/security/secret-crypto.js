// Centralized authenticated-encryption utility for secrets at rest.
//
// Uses AES-256-GCM (authenticated encryption) from Node's built-in crypto.
// Envelope format (all base64url, ':'-delimited):
//     v1:<iv>:<tag>:<ciphertext>
// - v1  : scheme version, so the format can evolve without ambiguity.
// - iv  : 12-byte random nonce (never reused with the same key).
// - tag : 16-byte GCM authentication tag (integrity + authenticity).
// - ct  : ciphertext.
//
// The key lives OUTSIDE the database (env config). Decryption failures (wrong
// key, tampered ciphertext) throw — callers fail closed rather than signing
// with a garbage secret. Plaintext secrets are never logged or embedded in
// error messages.
import crypto from 'node:crypto';

const SCHEME = 'v1';
const IV_BYTES = 12;

/**
 * Resolve a 32-byte AES key from configuration.
 * Accepts 64 hex chars, or base64/base64url that decodes to 32 bytes.
 * Returns a Buffer(32) or null when nothing usable is configured.
 */
export function resolveKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) return b;
  } catch { /* not base64 */ }
  return null;
}

/**
 * Derive a stable 32-byte key from a passphrase (e.g. JWT_SECRET) for
 * DEVELOPMENT ONLY. Deterministic so encrypted rows remain readable across
 * restarts without extra config. Never used in production (guarded by caller).
 */
export function deriveDevKey(passphrase) {
  return crypto.createHash('sha256').update(`mailhealth-webhook-secret:${passphrase || 'dev'}`).digest();
}

export class SecretCipher {
  /**
   * @param {Buffer} key 32-byte AES-256 key
   * @param {object} [meta] { derived:boolean } — provenance for diagnostics only
   */
  constructor(key, meta = {}) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error('SecretCipher requires a 32-byte key');
    }
    this._key = key;
    this.derived = !!meta.derived;
  }

  /** Encrypt a UTF-8 plaintext string into the v1 envelope. */
  encrypt(plaintext) {
    if (typeof plaintext !== 'string') throw new Error('plaintext must be a string');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [SCHEME, b64(iv), b64(tag), b64(ct)].join(':');
  }

  /** Decrypt a v1 envelope back to plaintext. Throws on tamper/wrong key. */
  decrypt(envelope) {
    if (!SecretCipher.isEnvelope(envelope)) throw new Error('invalid secret envelope');
    const [, ivB64, tagB64, ctB64] = envelope.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
    decipher.setAuthTag(tag);
    // If the key is wrong or the ciphertext/tag was tampered with, final() throws.
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /** True when a string looks like a v1 encryption envelope (not plaintext). */
  static isEnvelope(s) {
    return typeof s === 'string' && s.startsWith(SCHEME + ':') && s.split(':').length === 4;
  }
}

function b64(buf) { return buf.toString('base64'); }

/**
 * Build a SecretCipher from app config.
 * @param {object} opts
 * @param {string} [opts.key]        explicit configured key (hex/base64)
 * @param {string} [opts.devFallbackPassphrase] passphrase for a derived dev key
 * @param {boolean} [opts.isProd]    when true, a derived/fallback key is refused
 * @returns {SecretCipher}
 * @throws when no usable key is available (fail closed).
 */
export function createSecretCipher({ key, devFallbackPassphrase, isProd = false } = {}) {
  const explicit = resolveKey(key);
  if (explicit) return new SecretCipher(explicit, { derived: false });
  if (isProd) {
    throw new Error(
      'WEBHOOK_ENCRYPTION_KEY is required in production (32 bytes as 64 hex chars or base64).',
    );
  }
  // Development only: derive a deterministic key so local webhooks work.
  return new SecretCipher(deriveDevKey(devFallbackPassphrase), { derived: true });
}
