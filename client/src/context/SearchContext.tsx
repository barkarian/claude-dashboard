import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

export interface SearchHandler {
  findNext: (query: string, incremental?: boolean) => boolean;
  findPrevious: (query: string) => boolean;
  clearSearch: () => void;
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

  // Listen for Ctrl/Cmd+F on desktop — capture phase to prevent native find bar
  useEffect(() => {
    if (window.innerWidth < 768) return;

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsOpen(prev => {
          if (prev) handlerRef.current?.clearSearch();
          return !prev;
        });
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  return (
    <SearchContext.Provider value={{ isOpen, open, close, handler, registerHandler, unregisterHandler }}>
      {children}
    </SearchContext.Provider>
  );
}
