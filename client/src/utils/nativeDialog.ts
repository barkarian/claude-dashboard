import { isTauriDesktop } from './platform.ts';

/**
 * Opens a native directory picker dialog (Tauri only).
 * Returns the selected path, or throws with a descriptive error.
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauriDesktop()) {
    throw new Error('Native dialog not available (not running in Tauri)');
  }

  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });

    // null means user cancelled the dialog
    if (selected === null) return null;
    if (typeof selected === 'string') return selected;

    throw new Error(`Unexpected dialog result: ${JSON.stringify(selected)}`);
  } catch (e: any) {
    // Tauri IPC errors may be plain strings or objects without .message
    const detail = e?.message || (typeof e === 'string' ? e : JSON.stringify(e));
    throw new Error(detail);
  }
}
