import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/api.ts';

interface UiStateResponse<T> {
  value: T | null;
}

/**
 * Per-project UI state persisted to SQLite via /api/projects/:id/ui-state/:key.
 * Hydrates once on mount; subsequent updates are written through with a 300ms
 * debounce, plus a synchronous flush on tab hide / unmount so a navigation
 * away can't drop the user's last toggle.
 *
 * `ready` flips true once the initial fetch settles — callers that need to
 * seed an uncontrolled component (e.g. react-arborist's initialOpenState)
 * should gate the mount on it.
 */
export function useUiState<T>(projectId: string, key: string, defaultValue: T) {
  const [value, setValueState] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);

  const latestRef = useRef<T>(defaultValue);
  const savedRef = useRef<string>(JSON.stringify(defaultValue));
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const projectKeyRef = useRef(`${projectId}::${key}`);

  const flush = useCallback(() => {
    const next = latestRef.current;
    const serialized = JSON.stringify(next);
    if (serialized === savedRef.current) return;
    savedRef.current = serialized;
    api.put(`/api/projects/${projectId}/ui-state/${encodeURIComponent(key)}`, { value: next }).catch(() => {});
  }, [projectId, key]);

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setValueState(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      latestRef.current = resolved;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 300);
      return resolved;
    });
  }, [flush]);

  // Hydrate on (projectId, key) change. Reset ready/value so the stale state
  // from a previous project never bleeds into a freshly mounted tree.
  useEffect(() => {
    let cancelled = false;
    projectKeyRef.current = `${projectId}::${key}`;
    setReady(false);
    setValueState(defaultValue);
    latestRef.current = defaultValue;
    savedRef.current = JSON.stringify(defaultValue);

    api.get<UiStateResponse<T>>(`/api/projects/${projectId}/ui-state/${encodeURIComponent(key)}`)
      .then(({ value: stored }) => {
        if (cancelled) return;
        if (stored != null) {
          setValueState(stored);
          latestRef.current = stored;
          savedRef.current = JSON.stringify(stored);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => { cancelled = true; };
    // defaultValue intentionally excluded — callers usually pass a fresh literal
    // each render; including it would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key]);

  // Flush on tab hide and on unmount so quick navigations don't drop the last edit.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timerRef.current);
        flush();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timerRef.current);
      flush();
    };
  }, [flush]);

  return { value, setValue, ready };
}
