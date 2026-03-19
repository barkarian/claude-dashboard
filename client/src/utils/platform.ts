export function isCapacitorNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform;
}
