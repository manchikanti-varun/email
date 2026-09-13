import crypto from 'node:crypto';
import { ApiKeyService } from '../../domain/ports/index.js';

export class Sha256ApiKeyService extends ApiKeyService {
  // The plaintext key is shown to the user once; only the SHA-256 hash is
  // stored. A short prefix is kept in the clear for display.
  generate() {
    const raw = 'elh_' + crypto.randomBytes(24).toString('base64url');
    return { raw, hash: this.hash(raw), prefix: raw.slice(0, 12) };
  }
  hash(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
