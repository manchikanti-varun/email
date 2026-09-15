import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User } from './types';
import { api, setToken, setUnauthorizedHandler } from './api';
import { toast } from './components/Toaster';

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
