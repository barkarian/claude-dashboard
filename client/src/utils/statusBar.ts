import { isCapacitorNative } from './platform.ts';
import { getPlugin } from './capacitorBridge.ts';

export function initStatusBar() {
  updateStatusBarForTheme('dark');
}

export function updateStatusBarForTheme(resolved: 'light' | 'dark') {
  if (!isCapacitorNative()) return;
  const sb = getPlugin('StatusBar');
  if (!sb) return;
  sb.setStyle({ style: resolved === 'light' ? 'Light' : 'Dark' }).catch(() => {});
  // setBackgroundColor is Android-only — skip on iOS to avoid UNIMPLEMENTED error
  const isAndroid = (window as any).Capacitor?.getPlatform?.() === 'android';
  if (isAndroid) {
    const bgColor = resolved === 'light' ? '#ffffff' : '#0a0a0f';
    sb.setBackgroundColor({ color: bgColor }).catch(() => {});
  }
}
