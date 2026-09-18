// Login / signup form state + submit. Behavior mirrors the original AuthView:
//   - login → api.login → setToken + setUser
//   - register → api.register → setToken; store one-time apiKey in
//     sessionStorage under SIGNUP_API_KEY_STORAGE; setUser
//   - errors shown inline; busy disables submit
// Authentication semantics are unchanged; AuthProvider remains the source of
// truth for session/user state.
import { useCallback, useState } from 'react';
import { api, setToken } from '../../../api';
import { useAuth } from '../../../auth';
import { SIGNUP_API_KEY_STORAGE } from '../../../app/providers/AuthProvider';

export type AuthMode = 'login' | 'register';

export function useAuthForm() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isLogin = mode === 'login';

  const submit = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      const res = isLogin
        ? await api.login({ email: email.trim(), password })
        : await api.register({ email: email.trim(), password, name: name.trim() });
      setToken(res.token);
      const apiKey = (res as { apiKey?: string }).apiKey;
      if (!isLogin && apiKey) {
        sessionStorage.setItem(SIGNUP_API_KEY_STORAGE, apiKey);
      }
      setUser(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }, [isLogin, email, password, name, setUser]);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
  }, []);

  return {
    isLogin,
    name, setName,
    email, setEmail,
    password, setPassword,
    error, busy,
    submit, toggleMode,
  };
}
