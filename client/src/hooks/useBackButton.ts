import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getPlugin, resolveHandle } from '../utils/capacitorBridge.ts';

export function useBackButton(sidebarOpen: boolean, closeSidebar: () => void) {
  const navigate = useNavigate();
  const location = useLocation();

  // Use refs so the single listener always reads current values
  const sidebarOpenRef = useRef(sidebarOpen);
  const closeSidebarRef = useRef(closeSidebar);
  const navigateRef = useRef(navigate);
  const pathnameRef = useRef(location.pathname);

  sidebarOpenRef.current = sidebarOpen;
  closeSidebarRef.current = closeSidebar;
  navigateRef.current = navigate;
  pathnameRef.current = location.pathname;

  useEffect(() => {
    const app = getPlugin('App');
    if (!app) return;

    let handle: { remove: () => void } | null = null;

    const result = app.addListener('backButton', () => {
      if (sidebarOpenRef.current) {
        closeSidebarRef.current();
        return;
      }

      const path = pathnameRef.current;

      if (path.match(/^\/project\/([^/]+)\/.+/)) {
        navigateRef.current(-1);
        return;
      }

      if (path.match(/^\/project\/[^/]+$/)) {
        navigateRef.current('/');
        return;
      }

      if (path === '/' || path === '') {
        app.exitApp();
        return;
      }

      navigateRef.current(-1);
    });

    resolveHandle(result, (h) => { handle = h; });

    return () => { handle?.remove(); };
  }, []); // Register once — refs keep values current
}
