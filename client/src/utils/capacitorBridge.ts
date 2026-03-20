// Typed wrapper for Capacitor plugins injected into the WebView.
// We access window.Capacitor.Plugins directly instead of importing
// @capacitor/* npm packages in the dashboard client.
//
// IMPORTANT: In Capacitor 6's native bridge, addListener() returns the
// PluginListenerHandle synchronously (NOT a Promise). Our types and
// call-sites must account for both sync and async returns.

type ListenerHandle = { remove: () => void };
type MaybePromise<T> = T | Promise<T>;

interface HapticsPlugin {
  impact(opts: { style: 'Light' | 'Medium' | 'Heavy' }): Promise<void>;
  notification(opts: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
}

interface StatusBarPlugin {
  setStyle(opts: { style: 'Dark' | 'Light' }): Promise<void>;
  setBackgroundColor(opts: { color: string }): Promise<void>;
}

interface KeyboardPlugin {
  addListener(event: 'keyboardWillShow', cb: (info: { keyboardHeight: number }) => void): MaybePromise<ListenerHandle>;
  addListener(event: 'keyboardWillHide', cb: () => void): MaybePromise<ListenerHandle>;
}

interface AppPlugin {
  addListener(event: 'appStateChange', cb: (state: { isActive: boolean }) => void): MaybePromise<ListenerHandle>;
  addListener(event: 'backButton', cb: (data: { canGoBack: boolean }) => void): MaybePromise<ListenerHandle>;
  exitApp(): Promise<void>;
}

interface CapacitorPlugins {
  Haptics: HapticsPlugin;
  StatusBar: StatusBarPlugin;
  Keyboard: KeyboardPlugin;
  App: AppPlugin;
}

type PluginName = keyof CapacitorPlugins;

export function getPlugin<T extends PluginName>(name: T): CapacitorPlugins[T] | null {
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform) return null;
    return cap.Plugins?.[name] ?? null;
  } catch {
    return null;
  }
}

/**
 * Safely resolve an addListener result that may be sync or async.
 * Stores the handle via the provided setter callback.
 */
export function resolveHandle(
  result: MaybePromise<ListenerHandle>,
  setter: (h: ListenerHandle) => void,
) {
  if (result && typeof (result as any).then === 'function') {
    (result as Promise<ListenerHandle>).then(setter).catch(() => {});
  } else if (result && typeof (result as any).remove === 'function') {
    setter(result as ListenerHandle);
  }
}
