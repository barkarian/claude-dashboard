import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

export interface SearchHandler {
  findNext: (query: string, incremental?: boolean) => boolean;
  findPrevious: (query: string) => boolean;
  clearSearch: () => void;
  /**
   * Optional: subscribe to match-count updates from the underlying engine
   * (e.g. xterm.js SearchAddon's onDidChangeResults). Returns an unsubscribe
   * fn. SearchOverlay uses this to render a "3/17" indicator next to the
   * input when the active page is a terminal.
   */
  onResultsChange?: (cb: (info: { resultIndex: number; resultCount: number }) => void) => () => void;
}

interface SearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  handler: SearchHandler | null;
  registerHandler: (handler: SearchHandler) => void;
  unregisterHandler: (handler: SearchHandler) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch must be used within SearchProvider');
  return ctx;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const handlerRef = useRef<SearchHandler | null>(null);
  const [handler, setHandler] = useState<SearchHandler | null>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    handlerRef.current?.clearSearch();
  }, []);

  const registerHandler = useCallback((h: SearchHandler) => {
    handlerRef.current = h;
    setHandler(h);
  }, []);

  const unregisterHandler = useCallback((h: SearchHandler) => {
    if (handlerRef.current === h) {
      handlerRef.current = null;
      setHandler(null);
    }
  }, []);

  // Listen for Ctrl/Cmd+F on desktop. We only intercept the shortcut when a
  // page-scoped search handler is registered (chat views, script terminals).
  // Otherwise we fall through to the browser's native find bar so DOM-level
  // pages (workspace list, Catalog, settings, etc.) remain searchable.
  useEffect(() => {
    if (window.innerWidth < 768) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'f')) return;
      if (!handlerRef.current) {
        // No handler — close any stale overlay and let the browser handle Cmd+F.
        setIsOpen(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setIsOpen(prev => {
        if (prev) handlerRef.current?.clearSearch();
        return !prev;
      });
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Auto-close the overlay if the active handler unregisters (e.g. the user
  // navigates away from a chat). Avoids a stuck "find" bar with no target.
  useEffect(() => {
    if (!handler && isOpen) setIsOpen(false);
  }, [handler, isOpen]);

  return (
    <SearchContext.Provider value={{ isOpen, open, close, handler, registerHandler, unregisterHandler }}>
      {children}
    </SearchContext.Provider>
  );
}
