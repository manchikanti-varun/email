// Login / signup form. Uses useAuthForm for state + submit. Extracted from
// AuthView; labels + autocomplete + Enter-to-submit preserved.
import type { KeyboardEvent } from 'react';
import { useAuthForm } from '../hooks/useAuthForm';

export function AuthForm() {
  const {
    isLogin, name, setName, email, setEmail, password, setPassword, error, busy, submit, toggleMode,
  } = useAuthForm();

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="auth-card">
      <h2 style={{ margin: '0 0 4px' }}>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
      <p className="tagline">{isLogin ? 'Sign in to your dashboard.' : 'Start with free verification credits.'}</p>

      {!isLogin && (
        <div className="field">
          <label htmlFor="auth-name">Name</label>
          <input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" onKeyDown={onEnter} />
        </div>
      )}
      <div className="field">
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" autoComplete="email" onKeyDown={onEnter} />
      </div>
      <div className="field">
        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="••••••••"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          onKeyDown={onEnter}
        />
      </div>
      {!isLogin && (
        <p className="muted" style={{ fontSize: 12, margin: '-6px 0 10px' }}>
          At least 8 characters, with a letter and a number.
        </p>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn block" disabled={busy} onClick={submit}>
        {isLogin ? 'Sign in' : 'Create account'}
      </button>
      <p className="switch-link">
        {isLogin ? 'No account?' : 'Already registered?'}{' '}
        <a style={{ cursor: 'pointer' }} onClick={toggleMode}>
          {isLogin ? 'Create one' : 'Sign in'}
        </a>
      </p>
    </div>
  );
}
