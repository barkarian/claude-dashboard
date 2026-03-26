import type { ITheme } from '@xterm/xterm';

export const darkTerminalTheme: ITheme = {
  background: '#0f1117',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#0f1117',
  selectionBackground: 'rgba(255, 255, 255, 0.25)',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

export const lightTerminalTheme: ITheme = {
  background: '#ffffff',
  foreground: '#1e293b',
  cursor: '#1e293b',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0, 0, 0, 0.15)',
  black: '#1e293b',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f1f5f9',
  brightBlack: '#64748b',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

export function getTerminalTheme(resolved: 'light' | 'dark'): ITheme {
  return resolved === 'light' ? lightTerminalTheme : darkTerminalTheme;
}
