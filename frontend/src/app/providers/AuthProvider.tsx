// Authentication context provider.
//
// Relocated from src/auth.tsx (Phase 1B). Behavior is preserved verbatim:
//   - on mount, resolves the current session via api.me()
//   - installs the global 401 handler (clears token + user, toasts a message)
//   - refreshCredits() re-fetches the user
//   - logout() calls api.logout(), clears token + user, resets the hash route
//
// Public surface: <AuthProvider> and useAuth() — unchanged.
//
// NOTE — implicit cross-component contract (made explicit here):
// The signup flow stores the one-time API key in sessionStorage under the key
// 'newApiKey' (written by the auth view, read once by the API/settings view).
// AuthProvider itself does not touch that key; it is documented here so the
// contract is discoverable. See SIGNUP_API_KEY_STORAGE below.
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User } from '../../types';
import { api, setToken, setUnauthorizedHandler } from '../../api';
import { toast } from '../../components/ui/Toast';

// The sessionStorage key used to hand the one-time signup API key from the
// auth view to the API/settings view. Exported so both sides reference one
// constant instead of a magic string.
export const SIGNUP_API_KEY_STORAGE = 'newApiKey';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  refreshCredits: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      toast('Your session expired. Please sign in again.');
    });
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const refreshCredits = useCallback(() => {
    api.me().then(({ user }) => setUser(user)).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    location.hash = '';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser, refreshCredits, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
