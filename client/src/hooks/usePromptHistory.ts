import { useState, useCallback, useRef } from 'react';
import api from '../utils/api.ts';

interface PromptHistoryEntry {
  display: string;
  timestamp: number;
  sessionId: string;
}

const PAGE_SIZE = 50;

export function usePromptHistory(projectId: string | undefined) {
  const [entries, setEntries] = useState<PromptHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const fetchedRef = useRef(false);

  const load = useCallback(async (reset = false) => {
    if (!projectId) return;
    if (loading) return;

    const currentOffset = reset ? 0 : offsetRef.current;
    setLoading(true);

    try {
      const data = await api.get<{ entries: PromptHistoryEntry[]; total: number }>(
        `/api/projects/${projectId}/prompt-history?limit=${PAGE_SIZE}&offset=${currentOffset}`
      );
      const newEntries = data.entries || [];

      if (reset) {
        setEntries(newEntries);
      } else {
        setEntries(prev => [...prev, ...newEntries]);
      }

      const newOffset = currentOffset + newEntries.length;
      offsetRef.current = newOffset;
      setHasMore(newOffset < (data.total || 0));
      fetchedRef.current = true;
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, loading]);

  const loadMore = useCallback(() => {
    if (hasMore && !loading) {
      load(false);
    }
  }, [hasMore, loading, load]);

  const loadInitial = useCallback(() => {
    if (!fetchedRef.current) {
      load(true);
    }
  }, [load]);

  const refresh = useCallback(() => {
    fetchedRef.current = false;
    load(true);
  }, [load]);

  return { entries, loading, hasMore, loadMore, loadInitial, refresh };
}
