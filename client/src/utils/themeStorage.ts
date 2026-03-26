import { isTauriDesktop } from './platform.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

// Hide module specifier from Rollup's static analysis
const STORE_MODULE = '@tauri-apps/' + 'plugin-store';

async function getTauriStore() {
  const { Store } = await import(/* @vite-ignore */ STORE_MODULE);
  return Store.load('settings.json');
}

export async function loadThemePreference(): Promise<ThemePreference> {
  if (isTauriDesktop()) {
    try {
      const store = await getTauriStore();
      const val = await (store as any).get(STORAGE_KEY);
      if (val === 'light' || val === 'dark' || val === 'system') return val;
    } catch {
      // fall through to localStorage
    }
  }
  const val = localStorage.getItem(STORAGE_KEY);
  if (val === 'light' || val === 'dark' || val === 'system') return val;
  return 'system';
}

export async function saveThemePreference(pref: ThemePreference): Promise<void> {
  localStorage.setItem(STORAGE_KEY, pref);
  if (isTauriDesktop()) {
    try {
      const store = await getTauriStore();
      await (store as any).set(STORAGE_KEY, pref);
      await (store as any).save();
    } catch {
      // ignore
    }
  }
}
