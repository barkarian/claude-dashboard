import { isTauriDesktop } from './platform.ts';

/**
 * Opens a native directory picker dialog (Tauri only).
 * Returns the selected path or null if cancelled or on error.
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauriDesktop()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') return selected;
    return null;
  } catch (e) {
    console.error('Native directory picker failed:', e);
    return null;
  }
}
