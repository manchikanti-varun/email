// Single-email verification use case. Charges one credit, runs the engine, and
// returns the result along with the user's updated credit balance.
import { AppError } from './errors.js';
import { toPublicUser } from '../domain/entities/user.js';

export class VerifySingleEmail {
  constructor({ users, verificationEngine }) {
    this.users = users;
    this.engine = verificationEngine;
  }

  async execute(userId, rawEmail) {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || email.length > 254) {
      throw new AppError(400, 'A valid email is required');
    }
    if (!this.users.chargeCredits(userId, 1)) {
      throw new AppError(402, 'Insufficient credits');
    }
    const result = await this.engine.verify(email);
    const user = this.users.findById(userId);
    return { result, credits: user.credits, user: toPublicUser(user) };
  }
}
