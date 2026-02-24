import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../utils/api.ts';

interface AuthUser {
  username: string;
  email: string;
  userSubdomain: string;
  plan: 'free' | 'pro';
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isVps: boolean;
  loading: boolean;
  user: AuthUser | null;
  oauthUrl: string | null;
  logout: () => Promise<void>;
  refreshPlan: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVps, setIsVps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const data = await api.get<{ authenticated: boolean; isVps: boolean; user: AuthUser | null; oauthUrl: string | null }>('/api/auth/status');
      setIsAuthenticated(data.authenticated);
      setIsVps(data.isVps);
      setUser(data.user);
      setOauthUrl(data.oauthUrl);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  const refreshPlan = useCallback(async () => {
    try {
      const data = await api.post<{ plan: 'free' | 'pro' }>('/api/auth/refresh-plan');
      setUser((prev) => prev ? { ...prev, plan: data.plan } : prev);
    } catch (err) {
      console.error('Failed to refresh plan:', err);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isVps, loading, user, oauthUrl, logout, refreshPlan }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
