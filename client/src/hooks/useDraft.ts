import { useRef, useEffect, useCallback } from 'react';
import api from '../utils/api.ts';
import type { Project } from '../../../shared/types/models.ts';

/**
 * Persists draft message text to the server with debouncing.
 * Saves immediately on visibility change (tab switch) and component unmount.
 * Also updates the local project context so drafts survive navigation.
 */
export function useDraft(
  projectId: string,
  chatId: string | undefined,
  initialDraft: string = '',
  setProject?: React.Dispatch<React.SetStateAction<Project | null>>,
) {
  const savedRef = useRef(initialDraft);
  const currentRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback((text: string) => {
    if (!chatId || text === savedRef.current) return;
    savedRef.current = text;
    api.put(`/api/projects/${projectId}/chats/${chatId}/draft`, { text }).catch(() => {});
    // Update local project context so the draft survives SPA navigation
    setProject?.(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        chats: prev.chats.map(c =>
          c.id === chatId ? { ...c, draftMessage: text || null } : c
        ),
      };
    });
  }, [projectId, chatId, setProject]);

  const updateDraft = useCallback((text: string) => {
    currentRef.current = text;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 500);
  }, [save]);

  // Immediate, non-debounced clear. Use on send so a fast send →
  // refreshProject sequence can't read back a stale draft.
  const clearDraft = useCallback(() => {
    clearTimeout(timerRef.current);
    currentRef.current = '';
    save('');
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

  // Seed both refs with the persisted draft on chat change. savedRef so that
  // save('') on the next clear actually fires (it would otherwise short-circuit
  // because savedRef happened to still equal ''); currentRef so that the
  // unmount cleanup's save(currentRef.current) is a no-op when the user opened
  // the chat without typing — otherwise we'd PUT '' and wipe the existing draft.
  // Only re-seed when the chat itself changes; subsequent initialDraft updates
  // flow back from our own setProject() and must not clobber the user's
  // in-progress typing.
  useEffect(() => {
    savedRef.current = initialDraft;
    currentRef.current = initialDraft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  return { updateDraft, clearDraft };
}
