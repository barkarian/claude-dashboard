import { useRef, useEffect, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  loadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  rootMargin?: string;
}

export function useInfiniteScroll({ loadMore, hasMore, loading, rootMargin = '200px' }: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreRef.current();
        }
      },
      { rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, rootMargin]);

  return { sentinelRef };
}
