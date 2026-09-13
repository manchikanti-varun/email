// Application-level error carrying an HTTP-ish status. The interface layer
// translates these into responses; the domain/application never touch res/req.
export class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    Object.assign(this, extra);
  }
}
