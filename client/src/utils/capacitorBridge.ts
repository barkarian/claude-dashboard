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

// @capacitor/filesystem — only the subset we actually use.
// Directory values come from the plugin as string enums ("CACHE", "DATA", etc.).
interface FilesystemPlugin {
  writeFile(opts: {
    path: string;
    data: string; // base64 when encoding is omitted
    directory?: 'DOCUMENTS' | 'DATA' | 'CACHE' | 'EXTERNAL' | 'EXTERNAL_STORAGE' | 'LIBRARY';
    recursive?: boolean;
  }): Promise<{ uri: string }>;
  deleteFile(opts: { path: string; directory?: string }): Promise<void>;
  getUri(opts: { path: string; directory?: string }): Promise<{ uri: string }>;
}

// @capacitor/share — native iOS/Android Share Sheet.
interface SharePlugin {
  share(opts: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[]; // array of file URIs
    dialogTitle?: string;
  }): Promise<{ activityType?: string } | void>;
  canShare(): Promise<{ value: boolean }>;
}

interface CapacitorPlugins {
  Haptics: HapticsPlugin;
  StatusBar: StatusBarPlugin;
  Keyboard: KeyboardPlugin;
  App: AppPlugin;
  Filesystem: FilesystemPlugin;
  Share: SharePlugin;
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
