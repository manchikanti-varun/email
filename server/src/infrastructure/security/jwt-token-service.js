import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { TokenService } from '../../domain/ports/index.js';

export class JwtTokenService extends TokenService {
  constructor(secret, expiresIn = '7d') {
    super();
    this.secret = secret;
    this.expiresIn = expiresIn;
  }

  // Every token carries a unique `jti` so it can be individually revoked
  // (logout) without invalidating other tokens or all sessions.
  sign(user) {
    const jti = crypto.randomUUID();
    return jwt.sign({ sub: user.id }, this.secret, { expiresIn: this.expiresIn, jwtid: jti });
  }

  // Backward-compatible: returns the user id from a valid token, or null.
  verify(token) {
    const d = this.verifyDetailed(token);
    return d ? d.userId : null;
  }

  // Returns { userId, jti, exp } for a valid token, or null. `exp` is the JWT
  // expiry in seconds since epoch (used to bound how long a revocation entry
  // must live). Tokens issued before `jti` existed still verify (jti is null).
  verifyDetailed(token) {
    try {
      const payload = jwt.verify(token, this.secret);
      return {
        userId: payload.sub,
        jti: payload.jti || null,
        exp: typeof payload.exp === 'number' ? payload.exp : null,
      };
    } catch {
      return null;
    }
  }
}
