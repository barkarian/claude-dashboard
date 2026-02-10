/**
 * Persistent terminal cache — keeps xterm.js Terminal instances alive across
 * React navigation so returning to a chat is instant (no spinner, no buffer
 * replay, no terminal recreation).
 *
 * The socket output listener is bound here (not in the component) so the
 * terminal keeps receiving data even when ClaudeOutput is unmounted.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

// Width in px that comfortably fits ~120 cols at fontSize 14
const WIDE_WIDTH = 1024;

const TERM_OPTIONS: ConstructorParameters<typeof Terminal>[0] = {
  cursorBlink: true,
  cursorStyle: 'block',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  theme: {
    background: '#0f1117',
    foreground: '#e2e8f0',
    cursor: '#e2e8f0',
    cursorAccent: '#0f1117',
    selectionBackground: 'rgba(99, 102, 241, 0.3)',
    black: '#1a1d27',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#6366f1',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#e2e8f0',
    brightBlack: '#64748b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#818cf8',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#f8fafc',
  },
  disableStdin: true,
  scrollback: 10000,
  lineHeight: 1.1,
  convertEol: false,
};

interface CachedTerminal {
  term: Terminal;
  fitAddon: FitAddon;
  containerEl: HTMLDivElement;
  /** The socket instance that currently has the output listener bound */
  boundSocket: any;
  outputHandler: ((payload: any) => void) | null;
}

const cache = new Map<string, CachedTerminal>();

export function has(chatId: string): boolean {
  return cache.has(chatId);
}

export function getOrCreate(chatId: string): CachedTerminal {
  const existing = cache.get(chatId);
  if (existing) return existing;

  const containerEl = document.createElement('div');
  containerEl.className = 'absolute top-0 left-0 right-0 bottom-0';
  containerEl.style.padding = '4px';

  const term = new Terminal(TERM_OPTIONS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(containerEl);

  const entry: CachedTerminal = {
    term,
    fitAddon,
    containerEl,
    boundSocket: null,
    outputHandler: null,
  };
  cache.set(chatId, entry);
  return entry;
}

/**
 * Bind the `claude:output` socket listener (persistent — survives component
 * unmount). Returns `true` when a NEW binding was created, meaning the caller
 * should emit `claude:attach` to join the room and replay the buffer.
 */
export function bindSocket(chatId: string, socket: any): boolean {
  const entry = cache.get(chatId);
  if (!entry) return false;

  // Already bound to this exact socket — no-op
  if (entry.boundSocket === socket && entry.outputHandler) return false;

  // Unbind previous listener if socket changed
  if (entry.outputHandler && entry.boundSocket) {
    entry.boundSocket.off('claude:output', entry.outputHandler);
  }

  entry.outputHandler = ({ chatId: cid, data }: { chatId: string; data: string }) => {
    if (cid !== chatId) return;
    entry.term.write(data);
  };
  entry.boundSocket = socket;
  socket.on('claude:output', entry.outputHandler);

  return true;
}

/** Fit the terminal to a wrapper element, applying mobile scaling if needed. */
export function fit(chatId: string, wrapperEl: HTMLElement): void {
  const entry = cache.get(chatId);
  if (!entry || !wrapperEl) return;

  const isMobile = window.matchMedia('(max-width: 767px)').matches;

  if (isMobile) {
    const wrapperW = wrapperEl.offsetWidth;
    const wrapperH = wrapperEl.offsetHeight;
    const scale = Math.min(1, wrapperW / WIDE_WIDTH);

    entry.containerEl.style.width = `${WIDE_WIDTH}px`;
    entry.containerEl.style.height = `${wrapperH / scale}px`;
    entry.containerEl.style.transform = `scale(${scale})`;
    entry.containerEl.style.transformOrigin = 'top left';
  } else {
    entry.containerEl.style.width = '';
    entry.containerEl.style.height = '';
    entry.containerEl.style.transform = '';
    entry.containerEl.style.transformOrigin = '';
  }

  try {
    entry.fitAddon.fit();
  } catch {}
}

/** Destroy the terminal, unbind listeners, remove from cache. */
export function dispose(chatId: string): void {
  const entry = cache.get(chatId);
  if (!entry) return;

  if (entry.outputHandler && entry.boundSocket) {
    entry.boundSocket.off('claude:output', entry.outputHandler);
  }
  try {
    entry.term.dispose();
  } catch {}
  entry.containerEl.remove();
  cache.delete(chatId);
}
