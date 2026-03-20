import { useRef, useCallback } from 'react';
import { haptics } from '../utils/haptics.ts';

interface LongPressResult {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

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

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startPos.current = { x: touch.clientX, y: touch.clientY };

    timerRef.current = setTimeout(() => {
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

  const onTouchEnd = useCallback(() => {
    cancel();
  }, [cancel]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onContextMenu };
}
