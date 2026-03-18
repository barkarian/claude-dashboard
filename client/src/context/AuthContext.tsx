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
  /** True when the frontend is running inside the Tauri desktop shell.
   *  Determined server-side via CLAW_DESKTOP env var and communicated through
   *  the /api/auth/status response. We can't rely on window.__TAURI__ because
   *  the Tauri webview navigates to http://localhost (the Express server),
   *  which is a different origin from tauri://localhost where __TAURI__ is
   *  injected. */
  isDesktop: boolean;
  isVps: boolean;
  dashboardEnv: 'local' | 'vps';
  loading: boolean;
  user: AuthUser | null;
  oauthUrl: string | null;
  tunnelUrl: string | null;
  logout: () => Promise<void>;
  refreshPlan: () => Promise<void>;
}

interface AuthStatusResponse {
  authenticated: boolean;
  isDesktop?: boolean;
  isVps: boolean;
  dashboardEnv?: 'local' | 'vps';
  user: AuthUser | null;
  oauthUrl: string | null;
  tunnelUrl: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Derive env from URL as fallback
function getEnvFromUrl(): 'local' | 'vps' {
  const match = window.location.pathname.match(/^\/(local|vps)/);
  return match ? (match[1] as 'local' | 'vps') : 'local';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isVps, setIsVps] = useState(false);
  const [dashboardEnv, setDashboardEnv] = useState<'local' | 'vps'>(getEnvFromUrl());
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const data = await api.get<AuthStatusResponse>('/api/auth/status');
      setIsAuthenticated(data.authenticated);
      setIsDesktop(!!data.isDesktop);
      setIsVps(data.isVps);
      if (data.dashboardEnv) setDashboardEnv(data.dashboardEnv);
      setUser(data.user);
      setOauthUrl(data.oauthUrl);
      setTunnelUrl(data.tunnelUrl);

      // If not authenticated on a tunnel URL, redirect to gate login.
      // Skip this redirect in desktop mode — the desktop app handles auth
      // locally through the tunnel-auth OAuth flow, not through the gate.
      if (!data.authenticated && !data.isDesktop && window.location.hostname.endsWith('.claw-dev.com')) {
        const currentUrl = window.location.href;
        const tunnelDomain = window.location.hostname.split('.').slice(-2).join('.');
        window.location.href = `https://tunnel-api.${tunnelDomain}/gate/login?redirect=${encodeURIComponent(currentUrl)}`;
        return;
      }
    } catch {
      // If the auth check fails on a tunnel URL (e.g. CORS from gate redirect),
      // redirect to gate login. In desktop mode this catch won't fire because
      // localhost requests don't fail with CORS, but guard against it anyway.
      if (window.location.hostname.endsWith('.claw-dev.com')) {
        const currentUrl = window.location.href;
        const tunnelDomain = window.location.hostname.split('.').slice(-2).join('.');
        window.location.href = `https://tunnel-api.${tunnelDomain}/gate/login?redirect=${encodeURIComponent(currentUrl)}`;
        return;
      }
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }

  const logout = useCallback(async () => {
    if (isDesktop) {
      // Desktop app: full teardown — deactivates tunnel endpoints, disconnects
      // WebSocket, wipes SQLite credentials, and destroys the Express session.
      // Afterward, hard-navigate to "/" so any /vps or /local path preference
      // is forgotten; the next app launch starts fresh with a login prompt.
      await api.post('/api/tunnel-auth/disconnect');
      setIsAuthenticated(false);
      setUser(null);
      window.location.href = '/';
    } else {
      // Browser: fire logout API (don't await — redirect immediately to avoid CORS loop)
      api.post('/api/auth/logout').catch(() => {});
      // Build gate login redirect URL
      const isTunnel = window.location.hostname.endsWith('.claw-dev.com');
      if (isTunnel) {
        const dashboardUrl = window.location.origin + '/' + (window.location.pathname.match(/^\/(local|vps)/)?.[1] || 'local') + '/';
        const tunnelDomain = window.location.hostname.split('.').slice(-2).join('.');
        window.location.href = `https://tunnel-api.${tunnelDomain}/gate/login?redirect=${encodeURIComponent(dashboardUrl)}`;
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    }
  }, [isDesktop]);

  const refreshPlan = useCallback(async () => {
    try {
      const data = await api.post<{ plan: 'free' | 'pro' }>('/api/auth/refresh-plan');
      setUser((prev) => prev ? { ...prev, plan: data.plan } : prev);
    } catch (err) {
      console.error('Failed to refresh plan:', err);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isDesktop, isVps, dashboardEnv, loading, user, oauthUrl, tunnelUrl, logout, refreshPlan }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
