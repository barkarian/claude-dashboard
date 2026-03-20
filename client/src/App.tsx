import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.tsx';
import api from './utils/api.ts';
import { ProjectProvider } from './context/ProjectContext.tsx';
import { AppSidebarContext } from './context/SidebarContext.tsx';
import { SidebarProvider, useSidebar } from './components/ui/sidebar.tsx';
import ProjectListPage from './pages/ProjectListPage.tsx';
import ProjectDashboardPage from './pages/ProjectDashboardPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import BillingSuccessPage from './pages/BillingSuccessPage.tsx';
import BillingCancelPage from './pages/BillingCancelPage.tsx';
import MigrationPage from './pages/MigrationPage.tsx';
import AppSidebar, { type SidebarHandle } from './components/layout/Sidebar.tsx';
import { NewProjectDrawerProvider } from './context/NewProjectDrawerContext.tsx';
import NewProjectDrawer from './components/projects/NewProjectDrawer.tsx';
import { isCapacitorNative } from './utils/platform.ts';
import { initStatusBar } from './utils/statusBar.ts';
import { haptics } from './utils/haptics.ts';
import { useBackButton } from './hooks/useBackButton.ts';
import { swipeableRowActive } from './components/ui/SwipeableRow.tsx';

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
  const { isAuthenticated, isDesktop, loading, oauthUrl, tunnelUrl } = useAuth();
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

  // Redirect to tunnel URL when on localhost in a browser (not the Tauri webview).
  if (tunnelUrl && window.location.hostname === 'localhost' && !isDesktop) {
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

// Swipe-right gesture: edge swipe navigates back, other swipes open sidebar.
// Must be rendered inside SidebarProvider so it can call useSidebar().
function SwipeHandler() {
  const { setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  useEffect(() => {
    if (window.innerWidth >= 768) return; // desktop — no gesture needed
    const native = isCapacitorNative();
    const EDGE_ZONE = 30; // px from left edge for back-navigation gesture

    function handleTouchStart(e: TouchEvent) {
      const x = e.touches[0].clientX;
      // Native: track all swipes (edge for back, rest for sidebar)
      // Browser: only left edge zone 20-80px (0-20 reserved for iOS system gesture)
      if (native || (x >= 20 && x <= 80)) {
        touchRef.current = { startX: x, startY: e.touches[0].clientY };
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!touchRef.current) return;
      // If a SwipeableRow is active (swiping/cancelling), skip sidebar/nav
      if (swipeableRowActive.current) {
        touchRef.current = null;
        return;
      }
      const startX = touchRef.current.startX;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - startX;
      const dy = Math.abs(endY - touchRef.current.startY);
      touchRef.current = null;
      // Require 60px horizontal, mostly horizontal (dx > 2*dy)
      if (dx > 60 && dx > dy * 2) {
        const path = pathnameRef.current;
        const isRoot = path === '/' || path === '';

        // Native edge swipe: navigate back (unless on root page)
        if (native && startX < EDGE_ZONE && !isRoot) {
          haptics.impactLight();
          // Project sub-page → go back, project root → go to list
          if (path.match(/^\/project\/[^/]+$/)) {
            navigate('/');
          } else {
            navigate(-1);
          }
          return;
        }

        // All other qualifying swipes: open sidebar
        haptics.impactLight();
        setOpenMobile(true);
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [setOpenMobile, navigate]);

  return null;
}

// Android back button handler — must be inside SidebarProvider.
function BackButtonHandler() {
  const { openMobile, setOpenMobile } = useSidebar();
  useBackButton(openMobile, () => setOpenMobile(false));
  return null;
}

export default function App() {
  const sidebarRef = useRef<SidebarHandle>(null);
  const refreshProjects = useCallback(() => sidebarRef.current?.refreshProjects(), []);

  useEffect(() => { initStatusBar(); }, []);

  return (
    <Routes>
      <Route path="/*" element={
        <ProtectedRoute>
          <ProjectProvider>
            <SidebarProvider>
              <AppSidebarContext.Provider value={{ refreshProjects }}>
                <NewProjectDrawerProvider>
                  <SwipeHandler />
                  <BackButtonHandler />
                  <div className="app-layout flex w-full overflow-hidden">
                    <AppSidebar ref={sidebarRef} />
                    <main className="flex-1 flex flex-col overflow-hidden">
                      <Routes>
                        <Route path="/" element={<ProjectListPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/billing/success" element={<BillingSuccessPage />} />
                        <Route path="/billing/cancel" element={<BillingCancelPage />} />
                        <Route path="/migrate" element={<MigrationPage />} />
                        <Route path="/project/:id/*" element={<ProjectDashboardPage />} />
                      </Routes>
                    </main>
                  </div>
                  <NewProjectDrawer />
                </NewProjectDrawerProvider>
              </AppSidebarContext.Provider>
            </SidebarProvider>
          </ProjectProvider>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
