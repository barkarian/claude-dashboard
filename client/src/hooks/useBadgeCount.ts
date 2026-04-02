import { useEffect } from 'react';
import { useGlobalActiveChats } from './useGlobalActiveChats.ts';
import { isTauriDesktop, isCapacitorNative } from '../utils/platform.ts';

/**
 * Syncs the global active chat count to the platform's app badge.
 * - Tauri desktop: dock icon badge (macOS) / taskbar badge
 * - Capacitor mobile: app icon badge (iOS/Android)
 */
export function useBadgeCount(): void {
  const { badgeCount } = useGlobalActiveChats();

  useEffect(() => {
    if (isTauriDesktop()) {
      setTauriBadge(badgeCount);
    } else if (isCapacitorNative()) {
      setCapacitorBadge(badgeCount);
    }
  }, [badgeCount]);
}

async function setTauriBadge(count: number): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  } catch {
    // Not in Tauri environment or permission not granted
  }
}

async function setCapacitorBadge(count: number): Promise<void> {
  try {
    const { Badge } = await import('@capawesome/capacitor-badge');
    if (count > 0) {
      await Badge.set({ count });
    } else {
      await Badge.clear();
    }
  } catch {
    // Badge plugin not available
  }
}
