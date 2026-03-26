import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { loadThemePreference, saveThemePreference, type ThemePreference } from '../utils/themeStorage.ts';
import { updateStatusBarForTheme } from '../utils/statusBar.ts';
import { getTerminalTheme } from '../utils/terminalTheme.ts';
import type { ITheme } from '@xterm/xterm';

type Resolved = 'light' | 'dark';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: Resolved;
  terminalTheme: ITheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved: 'dark',
  terminalTheme: getTerminalTheme('dark'),
  setPreference: () => {},
});

function resolveTheme(pref: ThemePreference): Resolved {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeToDOM(resolved: Resolved) {
  const html = document.documentElement;
  if (resolved === 'light') {
    html.classList.add('light');
  } else {
    html.classList.remove('light');
  }
  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'light' ? '#ffffff' : '#6366f1');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<Resolved>(() => {
    // Sync read from DOM to match the inline script's decision
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
  });

  // Load persisted preference on mount
  useEffect(() => {
    loadThemePreference().then((pref) => {
      setPreferenceState(pref);
      const r = resolveTheme(pref);
      setResolved(r);
      applyThemeToDOM(r);
      updateStatusBarForTheme(r);
    });
  }, []);

  // Listen for OS theme changes when in system mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function handleChange() {
      if (preference !== 'system') return;
      const r = resolveTheme('system');
      setResolved(r);
      applyThemeToDOM(r);
      updateStatusBarForTheme(r);
    }
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    saveThemePreference(pref);
    const r = resolveTheme(pref);
    setResolved(r);
    applyThemeToDOM(r);
    updateStatusBarForTheme(r);
  }, []);

  const terminalTheme = getTerminalTheme(resolved);

  return (
    <ThemeContext.Provider value={{ preference, resolved, terminalTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
