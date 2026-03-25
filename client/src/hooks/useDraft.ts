import { useRef, useEffect, useCallback } from 'react';
import api from '../utils/api.ts';

/**
 * Persists draft message text to the server with debouncing.
 * Saves immediately on visibility change (tab switch) and component unmount.
 */
export function useDraft(projectId: string, chatId: string | undefined) {
  const savedRef = useRef('');
  const currentRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback((text: string) => {
    if (!chatId || text === savedRef.current) return;
    savedRef.current = text;
    api.put(`/api/projects/${projectId}/chats/${chatId}/draft`, { text }).catch(() => {});
  }, [projectId, chatId]);

  const updateDraft = useCallback((text: string) => {
    currentRef.current = text;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 500);
  }, [save]);

  // Save on visibility change (user switches tab/app) and on unmount
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimeout(timerRef.current);
        save(currentRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimeout(timerRef.current);
      save(currentRef.current);
    };
  }, [save]);

  // Reset refs when chatId changes so stale data isn't carried over
  useEffect(() => {
    savedRef.current = '';
    currentRef.current = '';
  }, [chatId]);

  return { updateDraft };
}
