// Single-email verification use case. Charges one credit, runs the engine, and
// returns the result along with the user's updated credit balance.
import { AppError } from './errors.js';
import { toPublicUser } from '../domain/entities/user.js';

export class VerifySingleEmail {
  // `calibrator` is OPTIONAL. When present, an additive ML `confidence` block is
  // attached to the deterministic result. The deterministic verdict is NEVER
  // modified, and a calibrator failure never affects verification (the block
  // falls back to deterministic confidence internally).
  constructor({ users, verificationEngine, calibrator = null }) {
    this.users = users;
    this.engine = verificationEngine;
    this.calibrator = calibrator;
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

    // Additive confidence calibration (backward-compatible: existing clients
    // that ignore `result.confidenceCalibration` are unaffected).
    if (this.calibrator) {
      try {
        result.confidenceCalibration = this.calibrator.calibrate(result);
      } catch { /* ML must never break verification */ }
    }

    const user = this.users.findById(userId);
    return { result, credits: user.credits, user: toPublicUser(user) };
  }
}
