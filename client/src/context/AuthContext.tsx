import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../utils/api.ts';

interface AuthUser {
  username: string;
  email: string;
  userSubdomain: string;
}

interface TunnelCredentials {
  apiKey: string;
  userSubdomain: string;
  email: string;
  username: string;
}

const TUNNEL_CREDS_KEY = 'tunnelCredentials';

function saveTunnelCredentials(creds: TunnelCredentials): void {
  try {
    localStorage.setItem(TUNNEL_CREDS_KEY, JSON.stringify(creds));
  } catch {
    // localStorage may be unavailable
  }
}

function loadTunnelCredentials(): TunnelCredentials | null {
  try {
    const raw = localStorage.getItem(TUNNEL_CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.apiKey && parsed.userSubdomain) return parsed;
    return null;
  } catch {
    return null;
  }
}

function clearTunnelCredentials(): void {
  try {
    localStorage.removeItem(TUNNEL_CREDS_KEY);
  } catch {
    // ignore
  }
}

interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  user: AuthUser | null;
  oauthUrl: string | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function restoreFromCredentials(creds: TunnelCredentials): Promise<boolean> {
    try {
      const restoreRes = await api.post<{ success: boolean }>('/api/tunnel-auth/restore', creds);
      if (restoreRes.success) {
        const recheck = await api.get<{
          authenticated: boolean;
          user: AuthUser | null;
          oauthUrl: string | null;
        }>('/api/auth/status');

        if (recheck.authenticated && recheck.user) {
          setIsAuthenticated(true);
          setUser(recheck.user);
          setOauthUrl(recheck.oauthUrl);
          saveTunnelCredentials(creds);
          return true;
        }
      }
    } catch {
      // restore failed
    }
    return false;
  }

  async function checkAuth() {
    try {
      // 1. Check existing session
      const data = await api.get<{
        authenticated: boolean;
        user: AuthUser | null;
        oauthUrl: string | null;
      }>('/api/auth/status');

      if (data.authenticated && data.user) {
        setIsAuthenticated(true);
        setUser(data.user);
        setOauthUrl(data.oauthUrl);

        // Persist credentials to localStorage (survives server restarts)
        try {
          const tunnelStatus = await api.get<{
            connected: boolean;
            apiKey: string | null;
            user: { username: string; email: string; userSubdomain: string } | null;
          }>('/api/tunnel-auth/status');

          if (tunnelStatus.apiKey && tunnelStatus.user) {
            saveTunnelCredentials({
              apiKey: tunnelStatus.apiKey,
              userSubdomain: tunnelStatus.user.userSubdomain,
              email: tunnelStatus.user.email,
              username: tunnelStatus.user.username,
            });
          }
        } catch {
          // Non-critical
        }

        return;
      }

      // 2. Not authenticated — try restoring from localStorage
      //    (handles server restarts where session is lost but localStorage persists)
      const saved = loadTunnelCredentials();
      if (saved) {
        const restored = await restoreFromCredentials(saved);
        if (restored) return;
        // Restore failed — clear stale credentials
        clearTunnelCredentials();
      }

      // 3. Not authenticated — will redirect to OAuth
      setIsAuthenticated(false);
      setOauthUrl(data.oauthUrl);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }

  const logout = useCallback(async () => {
    clearTunnelCredentials();
    await api.post('/api/auth/logout');
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, user, oauthUrl, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
