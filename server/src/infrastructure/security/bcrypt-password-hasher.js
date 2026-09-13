import bcrypt from 'bcryptjs';
import { PasswordHasher } from '../../domain/ports/index.js';

export class BcryptPasswordHasher extends PasswordHasher {
  constructor(rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10)) {
    super();
    this.rounds = rounds;
  }
  hash(plain) { return bcrypt.hashSync(plain, this.rounds); }
  verify(plain, hash) { return bcrypt.compareSync(plain, hash); }
}
