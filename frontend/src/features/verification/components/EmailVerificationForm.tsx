// The primary verification input. Email is the focal control. Emits run() on
// Enter or button click; shows the client-side validation message inline.
import type { KeyboardEvent } from 'react';
import { Button } from '../../../components/ui';

export function EmailVerificationForm({
  email,
  onEmailChange,
  onRun,
  busy,
  validationError,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  validationError?: string;
}) {
  return (
    <div className="verify-form">
      <label htmlFor="verify-email" className="verify-form-label">
        Enter an email address to verify its deliverability
      </label>
      <div className="verify-form-row">
        <input
          id="verify-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={!!validationError}
          aria-describedby={validationError ? 'verify-email-error' : undefined}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && onRun()}
          placeholder="name@company.com"
          className="verify-input"
        />
        <Button onClick={onRun} disabled={busy}>
          {busy ? 'Verifying…' : 'Verify'}
        </Button>
      </div>
      {validationError && (
        <p id="verify-email-error" className="verify-form-hint error" role="alert">
          {validationError}
        </p>
      )}
    </div>
  );
}
