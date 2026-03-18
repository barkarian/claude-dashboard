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
  /** True when the client is the Tauri desktop webview accessing the Express
   *  server directly on localhost. Detected entirely server-side: the server
   *  checks CLAW_DESKTOP=1 (set by Tauri sidecar) AND absence of
   *  X-Forwarded-Host (meaning the request didn't come through the tunnel
   *  proxy). Mobile/browser users always go through the tunnel, so they get
   *  isDesktop=false even though the same server has CLAW_DESKTOP=1. */
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
      // Trust the server's isDesktop flag — it checks CLAW_DESKTOP=1 AND
      // absence of X-Forwarded-Host (direct access = Tauri webview).
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
      // redirect to gate login.
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
      // Desktop app (Tauri webview on localhost): full teardown.
      // The disconnect endpoint sends its response first, then tears down
      // the tunnel WebSocket on a 500ms delay so the response can travel
      // back to us through the tunnel before it goes down.
      // After receiving the response, redirect to localhost so the webview
      // lands on the local Express server and shows the login screen.
      try {
        await api.post('/api/tunnel-auth/disconnect');
      } catch {
        // Best-effort — tunnel may already be down
      }
      setIsAuthenticated(false);
      setUser(null);
      window.location.href = `http://localhost:2222/`;
    } else {
      // Browser/mobile: fire logout API (don't await — redirect immediately to avoid CORS loop)
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
