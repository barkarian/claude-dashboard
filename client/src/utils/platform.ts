export function isCapacitorNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform;
}

export function isTauriDesktop(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}
