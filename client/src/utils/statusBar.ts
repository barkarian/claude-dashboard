import { isCapacitorNative } from './platform.ts';
import { getPlugin } from './capacitorBridge.ts';

export function initStatusBar() {
  if (!isCapacitorNative()) return;
  const sb = getPlugin('StatusBar');
  if (!sb) return;
  sb.setStyle({ style: 'Dark' }).catch(() => {});
  // setBackgroundColor is Android-only — skip on iOS to avoid UNIMPLEMENTED error
  const isAndroid = (window as any).Capacitor?.getPlatform?.() === 'android';
  if (isAndroid) {
    sb.setBackgroundColor({ color: '#0a0a0f' }).catch(() => {});
  }
}
