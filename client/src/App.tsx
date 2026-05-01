import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
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
import CatalogPage from './pages/CatalogPage.tsx';
import CatalogItemPage from './pages/CatalogItemPage.tsx';
import AppSidebar, { type SidebarHandle } from './components/layout/Sidebar.tsx';
import { NewProjectDrawerProvider } from './context/NewProjectDrawerContext.tsx';
import { DesktopUpdateProvider } from './context/DesktopUpdateContext.tsx';
import { SearchProvider } from './context/SearchContext.tsx';
import NewProjectDrawer from './components/projects/NewProjectDrawer.tsx';
import SearchOverlay from './components/ui/SearchOverlay.tsx';
import CommandPalette from './components/ui/CommandPalette.tsx';
import NewAgentDialog from './components/chat/NewAgentDialog.tsx';
import { NewAgentProvider } from './context/NewAgentContext.tsx';
import { useNewAgent } from './hooks/useNewAgent.ts';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { isCapacitorNative } from './utils/platform.ts';
import { haptics } from './utils/haptics.ts';
import { useBackButton } from './hooks/useBackButton.ts';
import { swipeableRowActive } from './components/ui/SwipeableRow.tsx';
import { longPressActive } from './hooks/useLongPress.ts';
import { ccSwipeOverride } from './utils/ccSwipeOverride.ts';
import { useBadgeCount } from './hooks/useBadgeCount.ts';

/** Auto-detect and enable adapters on first launch (runs once) */
function AdapterAutoDetect() {
  const hasRun = useRef(false);
  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    // Check if first run (no adapter settings exist yet)
    api.get<{ needsSetup: boolean }>('/api/adapter-settings/needs-setup')
      .then(({ needsSetup }) => {
        if (needsSetup) {
          return api.post('/api/adapter-settings/auto-detect');
        }
      })
      .catch(() => {}); // silent — auto-detect is best-effort
  }, []);
  return null;
}

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
  const touchRef = useRef<{
    startX: number;
    startY: number;
    lastY: number;
    twoFinger: boolean;
    inTerminal: boolean;
    scrolling: boolean;
  } | null>(null);
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  useEffect(() => {
    if (window.innerWidth >= 768) return; // desktop — no gesture needed
    const native = isCapacitorNative();
    const EDGE_ZONE = 30; // px from left edge for back-navigation gesture

    function handleTouchStart(e: TouchEvent) {
      // Second finger added to an in-progress gesture → upgrade to two-finger mode
      if (touchRef.current && e.touches.length >= 2) {
        touchRef.current.twoFinger = true;
        return;
      }
      // Taps on buttons/links are owned by those elements — don't let the
      // global gesture layer compete with them (and potentially mis-fire).
      const targetEl = e.target as Element | null;
      if (targetEl?.closest?.('button, a, [role="button"]')) return;

      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const twoFinger = e.touches.length >= 2;
      // CC override: only track swipes that start inside the terminal area.
      // Swipes on the prompt/keys area are ignored so they don't interfere
      // with text selection. Edge swipes still navigate back.
      if (ccSwipeOverride.current) {
        const container = ccSwipeOverride.containerEl;
        const inTerminal = !!(container && container.contains(e.target as Node));
        if (inTerminal) {
          touchRef.current = { startX: x, startY: y, lastY: y, twoFinger, inTerminal: true, scrolling: false };
        } else if (native && x < EDGE_ZONE) {
          // Allow edge swipe back even from outside terminal
          touchRef.current = { startX: x, startY: y, lastY: y, twoFinger: false, inTerminal: false, scrolling: false };
        }
        return;
      }
      // Native: track all swipes (edge for back, rest for sidebar)
      // Browser: only left edge zone 20-80px (0-20 reserved for iOS system gesture)
      if (native || (x >= 20 && x <= 80)) {
        touchRef.current = { startX: x, startY: y, lastY: y, twoFinger, inTerminal: false, scrolling: false };
      }
    }

    function handleTouchMove(e: TouchEvent) {
      const t = touchRef.current;
      if (!t || !t.inTerminal) return;
      if (!ccSwipeOverride.current || !ccSwipeOverride.scroll) return;

      const currentY = e.touches[0].clientY;
      const delta = currentY - t.lastY;
      if (delta === 0) return;

      // Two-finger vertical = always scroll.
      // Single-finger = scroll only when no up/down arrows are bound (so we don't
      // steal gestures that should map to arrow keys).
      const noUpDown =
        !ccSwipeOverride.allowedDirections.has('up') &&
        !ccSwipeOverride.allowedDirections.has('down');
      if (!t.twoFinger && !noUpDown) return;

      // Natural scroll: finger moves down → content moves down with finger,
      // revealing older lines above (scrollTop decreases).
      ccSwipeOverride.scroll(-delta);
      t.lastY = currentY;
      t.scrolling = true;
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!touchRef.current) return;
      // If a SwipeableRow is active (swiping/cancelling), skip sidebar/nav
      if (swipeableRowActive.current) {
        touchRef.current = null;
        return;
      }
      // If a long-press has fired (context menu is open), the touch has already
      // been consumed — don't treat the drag-to-menu-button as a sidebar swipe.
      if (longPressActive.current) {
        touchRef.current = null;
        return;
      }
      const startX = touchRef.current.startX;
      const startY = touchRef.current.startY;
      const scrolling = touchRef.current.scrolling;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - startX;
      const dy = endY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      touchRef.current = null;

      // If touchmove already scrolled the terminal for this gesture, the swipe
      // is spent — don't also fire arrow keys or sidebar/nav on release.
      if (scrolling) return;

      // Claude Code chat override: map swipes to arrow directions,
      // BUT edge swipes (from left edge) still navigate back
      if (ccSwipeOverride.current) {
        // Edge swipe right on native → navigate back instead of sending arrow
        if (native && startX < EDGE_ZONE && dx > 60 && dx > absDy * 2) {
          const path = pathnameRef.current;
          const isRoot = path === '/' || path === '';
          if (!isRoot) {
            haptics.impactLight();
            if (path.match(/^\/project\/[^/]+$/)) {
              navigate('/');
            } else {
              navigate(-1);
            }
            return;
          }
        }

        const MIN_DIST = 40;
        let consumed = false;
        if (absDx > absDy && absDx > MIN_DIST) {
          // Natural scroll: swipe right = arrow left, swipe left = arrow right
          const dir = dx > 0 ? 'left' as const : 'right' as const;
          if (ccSwipeOverride.allowedDirections.has(dir)) {
            haptics.impactLight();
            ccSwipeOverride.current(dir);
            consumed = true;
          }
        } else if (absDy > absDx && absDy > MIN_DIST) {
          // Natural scroll: swipe up = arrow down, swipe down = arrow up
          const dir = dy > 0 ? 'up' as const : 'down' as const;
          if (ccSwipeOverride.allowedDirections.has(dir)) {
            haptics.impactLight();
            ccSwipeOverride.current(dir);
            consumed = true;
          }
        }
        // If the swipe was consumed as an arrow key, stop here.
        // Otherwise fall through to normal swipe handling (sidebar, etc.)
        if (consumed) return;
      }

      // Require 60px horizontal, mostly horizontal (dx > 2*dy)
      if (dx > 60 && dx > absDy * 2) {
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
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
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

// Syncs global active chat count to platform badge (dock icon / app icon).
function BadgeManager() {
  useBadgeCount();
  return null;
}

/**
 * Cmd+N (or Ctrl+N) anywhere in the app opens the New Agent dialog. The
 * dialog itself is mounted at the app root.
 */
function NewAgentHotkey() {
  const { startNewAgent } = useNewAgent();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N'))) return;
      // Don't hijack typing in inputs/textareas/contentEditable.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      e.preventDefault();
      startNewAgent();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startNewAgent]);

  return null;
}

export default function App() {
  const sidebarRef = useRef<SidebarHandle>(null);
  const refreshProjects = useCallback(() => sidebarRef.current?.refreshProjects(), []);

  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/*" element={
        <ProtectedRoute>
          <DesktopUpdateProvider>
          <ProjectProvider>
            <SidebarProvider>
              <AppSidebarContext.Provider value={{ refreshProjects }}>
                <NewProjectDrawerProvider>
                <NewAgentProvider>
                  <SwipeHandler />
                  <BackButtonHandler />
                  <BadgeManager />
                  <AdapterAutoDetect />
                  <SearchProvider>
                  <div className="app-layout flex w-full overflow-hidden">
                    <AppSidebar ref={sidebarRef} />
                    <main className="flex-1 flex flex-col overflow-hidden relative">
                      <SearchOverlay />
                      <Routes>
                        <Route path="/" element={<ProjectListPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/catalog" element={<CatalogPage />} />
                        <Route path="/catalog/:id" element={<CatalogItemPage />} />
                        {/* Legacy: My Computer became the Local Computer service in the Catalog. */}
                        <Route path="/my-computer" element={<Navigate to="/catalog/local-computer" replace />} />
                        <Route path="/billing/success" element={<BillingSuccessPage />} />
                        <Route path="/billing/cancel" element={<BillingCancelPage />} />
                        <Route path="/migrate" element={<MigrationPage />} />
                        <Route path="/project/:id/*" element={<ProjectDashboardPage />} />
                      </Routes>
                    </main>
                  </div>
                  <NewProjectDrawer />
                  <CommandPalette />
                  <NewAgentDialog />
                  <NewAgentHotkey />
                  </SearchProvider>
                </NewAgentProvider>
                </NewProjectDrawerProvider>
              </AppSidebarContext.Provider>
            </SidebarProvider>
          </ProjectProvider>
          </DesktopUpdateProvider>
        </ProtectedRoute>
      } />
    </Routes>
    </ErrorBoundary>
  );
}
