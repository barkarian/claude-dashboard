export function isCapacitorNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform;
}

/**
 * Detect if running inside a native WebView (iOS WKWebView or Android WebView)
 * that has registered a haptic feedback bridge.
 */
export function isNativeWebView(): boolean {
  const w = window as any;
  return !!(
    w.webkit?.messageHandlers?.haptic ||   // iOS WKWebView
    w.NativeBridge?.haptic                  // Android WebView
  );
}

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/**
 * Trigger native haptic feedback. Only fires inside a native WebView —
 * completely silent in regular browsers. No fallback to navigator.vibrate().
 */
export function haptic(style: HapticStyle = 'medium'): void {
  const w = window as any;

  // iOS: WKScriptMessageHandler bridge
  if (w.webkit?.messageHandlers?.haptic) {
    w.webkit.messageHandlers.haptic.postMessage({ style });
    return;
  }

  // Android: @JavascriptInterface bridge
  if (w.NativeBridge?.haptic) {
    w.NativeBridge.haptic(style);
    return;
  }

  // Not in a native WebView — do nothing
}
