import { useRef, useState, useCallback, type ReactNode, type TouchEvent } from 'react';
import { haptics } from '../../utils/haptics.ts';

// Module-level flag so SwipeHandler in App.tsx can skip sidebar/nav during swipe interactions
export const swipeableRowActive = { current: false };

interface SwipeableRowProps {
  onDelete?: () => void;
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
}

const REVEAL_THRESHOLD = -80;
const DELETE_THRESHOLD = -160;

export default function SwipeableRow({ onDelete, onDismiss, children, className }: SwipeableRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const revealedHaptic = useRef(false);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const action = onDelete || onDismiss;
  const isDismiss = !onDelete && !!onDismiss;

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!isMobile) return;
    // If row is already revealed, flag so SwipeHandler skips sidebar/nav
    if (offsetX !== 0) {
      swipeableRowActive.current = true;
    }
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swiping.current = false;
    revealedHaptic.current = false;
    setTransitioning(false);
  }, [isMobile, offsetX]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;

    // Determine direction on first significant move
    if (!swiping.current && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

    if (!swiping.current) {
      // If vertical or right-swipe, abort
      if (Math.abs(dy) > Math.abs(dx) || dx > 0) {
        touchStart.current = null;
        return;
      }
      swiping.current = true;
      swipeableRowActive.current = true;
    }

    // Only allow left swipe (negative dx)
    const clamped = Math.max(dx, DELETE_THRESHOLD);
    setOffsetX(clamped);

    if (clamped <= REVEAL_THRESHOLD && !revealedHaptic.current) {
      revealedHaptic.current = true;
      haptics.impactLight();
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    // Defer clearing so document-level SwipeHandler touchend sees the flag first
    setTimeout(() => { swipeableRowActive.current = false; }, 0);

    if (!swiping.current) {
      touchStart.current = null;
      setOffsetX(0);
      return;
    }
    touchStart.current = null;

    if (offsetX <= DELETE_THRESHOLD && action) {
      if (isDismiss) {
        haptics.impactLight();
      } else {
        haptics.notificationError();
      }
      setTransitioning(true);
      setOffsetX(0);
      action();
    } else if (offsetX <= REVEAL_THRESHOLD) {
      // Snap to reveal position
      setTransitioning(true);
      setOffsetX(REVEAL_THRESHOLD);
    } else {
      setTransitioning(true);
      setOffsetX(0);
    }
    swiping.current = false;
  }, [offsetX, action, isDismiss]);

  // Close on click when revealed
  const handleClick = useCallback(() => {
    if (offsetX !== 0) {
      setTransitioning(true);
      setOffsetX(0);
    }
  }, [offsetX]);

  if (!isMobile || !action) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`relative overflow-hidden ${className || ''}`}>
      {/* Action zone behind */}
      {offsetX < 0 && (
        <div className={`absolute inset-y-0 right-0 flex items-center justify-center text-white text-sm font-medium ${isDismiss ? 'bg-text-dim' : 'bg-danger'}`}
          style={{ width: Math.abs(offsetX) }}
        >
          {isDismiss ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          )}
        </div>
      )}
      {/* Content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: transitioning ? 'transform 200ms ease-out' : 'none',
        }}
        onTransitionEnd={() => setTransitioning(false)}
      >
        {children}
      </div>
    </div>
  );
}
