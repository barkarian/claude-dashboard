import { useRef, useCallback } from 'react';
import { haptics } from '../utils/haptics.ts';

interface LongPressResult {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

// Module-level flag so the global swipe handler in App.tsx can skip its
// sidebar/nav logic while a long-press is "live" — i.e. from the moment the
// long-press fires (context menu opens) until the originating touch lifts.
// Without this, dragging the finger from the file row to a menu button
// registers as a big horizontal swipe and opens the sidebar.
export const longPressActive = { current: false };

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

export function useLongPress(onActivate: (position: { x: number; y: number }) => void): LongPressResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
  }, []);

  const firedRef = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startPos.current = { x: touch.clientX, y: touch.clientY };
    firedRef.current = false;

    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      longPressActive.current = true;
      haptics.impactLight();
      onActivate({ x: touch.clientX, y: touch.clientY });
      timerRef.current = null;
    }, LONG_PRESS_MS);
  }, [onActivate]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPos.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startPos.current.x);
    const dy = Math.abs(touch.clientY - startPos.current.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
      cancel();
    }
  }, [cancel]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    // If long-press already fired, prevent the click/tap from propagating
    if (firedRef.current) {
      e.preventDefault();
    }
    longPressActive.current = false;
    cancel();
  }, [cancel]);

  const onContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onContextMenu };
}
