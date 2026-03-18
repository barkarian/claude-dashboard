import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './context/AuthContext.tsx';
import api from './utils/api.ts';
import { ProjectProvider } from './context/ProjectContext.tsx';
import { SidebarContext } from './context/SidebarContext.tsx';
import ProjectListPage from './pages/ProjectListPage.tsx';
import NewProjectPage from './pages/NewProjectPage.tsx';
import ProjectDashboardPage from './pages/ProjectDashboardPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import BillingSuccessPage from './pages/BillingSuccessPage.tsx';
import BillingCancelPage from './pages/BillingCancelPage.tsx';
import MigrationPage from './pages/MigrationPage.tsx';
import Sidebar from './components/layout/Sidebar.tsx';

function BrandedLoader({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-6">
      <h1
        style={{
          fontSize: '2rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        Claw Dev
      </h1>
      <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      {message && <p className="text-sm text-text-muted">{message}</p>}
    </div>
  );
}

interface ProtectedRouteProps {
  children: ReactNode;
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading, oauthUrl, tunnelUrl } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  // When authenticated on tunnel with no env prefix, redirect to LOCAL (priority) or VPS
  // Must use window.location.pathname (not React Router's location.pathname which strips the basename)
  useEffect(() => {
    if (!isAuthenticated || loading) return;
    const hasEnvPrefix = /^\/(local|vps)(\/|$)/.test(window.location.pathname);
    const isTunnel = window.location.hostname.endsWith('.claw-dev.com');
    if (hasEnvPrefix || !isTunnel) return;

    setRedirecting(true);
    api.get<{ modes: string[] }>('/api/tunnel-auth/modes')
      .then((data) => {
        const target = data.modes.includes('local') ? '/local/' : data.modes.includes('vps') ? '/vps/' : null;
        if (target) {
          // Full page navigation — changing env prefix requires new basename initialization
          window.location.replace(window.location.origin + target);
        } else {
          setRedirecting(false);
        }
      })
      .catch(() => setRedirecting(false));
  }, [isAuthenticated, loading]);

  if (loading || redirecting) {
    return <BrandedLoader />;
  }

  // Redirect to tunnel URL when it's available (tunnel already connected server-side)
  // This covers both: authenticated on localhost AND not-authenticated-but-tunnel-connected
  if (tunnelUrl && window.location.hostname === 'localhost') {
    window.location.href = tunnelUrl;
    return <BrandedLoader message="Redirecting to dashboard..." />;
  }

  // Fallback: tunnel not connected at all (first-time setup) → OAuth login
  if (!isAuthenticated) {
    if (oauthUrl) {
      window.location.href = oauthUrl;
    }
    return <BrandedLoader message="Redirecting to login..." />;
  }

  return children;
}

// Swipe-right gesture to open sidebar (mobile only).
// Starts from left 20-80px zone (avoids iOS back gesture at 0-20px edge).
function useSwipeToOpenSidebar(onOpen: () => void) {
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 768) return; // desktop — no gesture needed

    function handleTouchStart(e: TouchEvent) {
      const x = e.touches[0].clientX;
      // Only start tracking if touch begins in the left edge zone (20–80px)
      // 0-20px is reserved for iOS system back gesture
      if (x >= 20 && x <= 80) {
        touchRef.current = { startX: x, startY: e.touches[0].clientY };
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!touchRef.current) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - touchRef.current.startX;
      const dy = Math.abs(endY - touchRef.current.startY);
      touchRef.current = null;
      // Require 60px horizontal, mostly horizontal (dx > 2*dy)
      if (dx > 60 && dx > dy * 2) {
        onOpen();
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onOpen]);
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  useSwipeToOpenSidebar(openSidebar);

  return (
    <Routes>
      <Route path="/*" element={
        <ProtectedRoute>
          <ProjectProvider>
            <SidebarContext.Provider value={{ openSidebar }}>
              <div className="h-[100dvh] flex flex-col md:flex-row overflow-hidden">
                <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                <main className="flex-1 flex flex-col overflow-hidden">
                  <Routes>
                    <Route path="/" element={<ProjectListPage />} />
                    <Route path="/new" element={<NewProjectPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/billing/success" element={<BillingSuccessPage />} />
                    <Route path="/billing/cancel" element={<BillingCancelPage />} />
                    <Route path="/migrate" element={<MigrationPage />} />
                    <Route path="/project/:id/*" element={<ProjectDashboardPage />} />
                  </Routes>
                </main>
              </div>
            </SidebarContext.Provider>
          </ProjectProvider>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
