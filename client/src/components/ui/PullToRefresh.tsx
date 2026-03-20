import { useRef, useState, useCallback, type ReactNode, type TouchEvent } from 'react';
import { haptics } from '../../utils/haptics.ts';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
}

const THRESHOLD = 80;
const MAX_PULL = 120;
const DAMPING = 0.4;

export default function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pulling = useRef(false);
  const crossedThreshold = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Only active on mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!isMobile || refreshing) return;
    // Only start if scrolled to top
    const el = containerRef.current;
    if (el && el.scrollTop > 0) return;
    touchStartY.current = e.touches[0].clientY;
    pulling.current = true;
    crossedThreshold.current = false;
  }, [isMobile, refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current || refreshing) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    const damped = Math.min(delta * DAMPING, MAX_PULL);
    setPullDistance(damped);

    if (damped >= THRESHOLD && !crossedThreshold.current) {
      crossedThreshold.current = true;
      haptics.impactMedium();
    } else if (damped < THRESHOLD) {
      crossedThreshold.current = false;
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;

    if (pullDistance >= THRESHOLD) {
      setRefreshing(true);
      setPullDistance(THRESHOLD * DAMPING); // Hold at spinner position
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  if (!isMobile) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ position: 'relative', overflow: 'auto' }}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
        style={{
          height: pullDistance > 0 ? pullDistance : 0,
          transition: pulling.current ? 'none' : undefined,
        }}
      >
        {refreshing ? (
          <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
        ) : pullDistance > 0 ? (
          <svg
            className="w-5 h-5 text-text-dim transition-transform"
            style={{ transform: pullDistance >= THRESHOLD ? 'rotate(180deg)' : 'rotate(0deg)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        ) : null}
      </div>
      {children}
    </div>
  );
}
