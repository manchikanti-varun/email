import jwt from 'jsonwebtoken';
import { TokenService } from '../../domain/ports/index.js';

export class JwtTokenService extends TokenService {
  constructor(secret, expiresIn = '7d') {
    super();
    this.secret = secret;
    this.expiresIn = expiresIn;
  }
  sign(user) {
    return jwt.sign({ sub: user.id }, this.secret, { expiresIn: this.expiresIn });
  }
  // Returns the user id from a valid token, or null.
  verify(token) {
    try { return jwt.verify(token, this.secret).sub; }
    catch { return null; }
  }
}
