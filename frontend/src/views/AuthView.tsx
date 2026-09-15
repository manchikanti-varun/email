import { useState, type KeyboardEvent } from 'react';
import { api, setToken } from '../api';
import { useAuth } from '../auth';

const FEATURES: [string, string, string][] = [
  ['✓', 'Multi-level verification', 'Syntax, DNS, MX, SMTP, disposable, role & catch-all detection in one pass.'],
  ['◎', 'Explainable results', 'Every risky address gets a plain-language reason and a clear recommendation.'],
  ['♥', 'List health score', 'A single 0–100 score with deliverability, data-quality, risk & domain metrics.'],
  ['↻', 'Ongoing monitoring', 'Scheduled re-verification, health-drop alerts, and history over time.'],
];

export function AuthView() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  async function go() {
    setError('');
    setBusy(true);
    try {
      const res = isLogin
        ? await api.login({ email: email.trim(), password })
        : await api.register({ email: email.trim(), password, name: name.trim() });
      setToken(res.token);
      const apiKey = (res as { apiKey?: string }).apiKey;
      if (!isLogin && apiKey) {
        sessionStorage.setItem('newApiKey', apiKey);
      }
      setUser(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') go();
  };

  return (
    <div className="landing">
      <section className="hero">
        <h1 className="brand-lg" style={{ fontSize: 34 }}>
          Mail<span>Health</span>
        </h1>
        <p className="hero-lead">Know which emails are safe to send — and why.</p>
        <p className="hero-sub">
          Upload your list. Understand its health. See which contacts to keep, review, or remove, with a clear
          reason for each. Beyond valid/invalid.
        </p>
        <div className="feature-grid">
          {FEATURES.map(([ic, t, d]) => (
            <div className="feature" key={t}>
              <div className="feature-ic">{ic}</div>
              <div>
                <b>{t}</b>
                <div className="muted">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="auth-card">
        <h2 style={{ margin: '0 0 4px' }}>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
        <p className="tagline">{isLogin ? 'Sign in to your dashboard.' : 'Start with free verification credits.'}</p>

        {!isLogin && (
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" onKeyDown={onEnter} />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" autoComplete="email" onKeyDown={onEnter} />
        </div>
        <div className="field">
          <label>Password</label>
          <input
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
        <div className="error">{error}</div>
        <button className="btn block" disabled={busy} onClick={go}>
          {isLogin ? 'Sign in' : 'Create account'}
        </button>
        <p className="switch-link">
          {isLogin ? 'No account?' : 'Already registered?'}{' '}
          <a style={{ cursor: 'pointer' }} onClick={() => { setMode(isLogin ? 'register' : 'login'); setError(''); }}>
            {isLogin ? 'Create one' : 'Sign in'}
          </a>
        </p>
      </div>
    </div>
  );
}
