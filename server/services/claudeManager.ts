import pty from 'node-pty';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { analyzeBuffer } from './bufferAnalyzer.ts';
import type { Server as SocketIOServer } from 'socket.io';
import type { SessionStatus, InteractiveState, AllowedKey } from '../../shared/types/interactive.ts';

// @xterm/headless is CJS-only; use createRequire for ESM compat
import type { Terminal as TerminalInstance } from '@xterm/headless';
const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');

const MAX_BUFFER_SIZE = 50000;

interface ClaudeSession {
  pty: pty.IPty;
  headlessTerminal: TerminalInstance;
  status: SessionStatus;
  projectId: string;
  chatId: string;
  buffer: string;
  responseBuffer: string;
  currentPromptId: string | null;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  startupComplete: boolean;
  lastInteractiveState: InteractiveState | null;
}

// Resolve the full path to the claude binary
function findClaudeBinary(): string {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const candidate of candidates) {
    try {
      execSync(`test -x "${candidate}"`, { stdio: 'ignore' });
      return candidate;
    } catch {}
  }

  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {}

  return 'claude';
}

const CLAUDE_BINARY = findClaudeBinary();
console.log(`Claude binary resolved to: ${CLAUDE_BINARY}`);

const sessions = new Map<string, ClaudeSession>();

const KEY_MAP: Record<AllowedKey, string> = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Enter: '\r',
  Escape: '\x1b',
  Tab: '\t',
  ShiftTab: '\x1b[Z',
};

/** Read all non-empty lines from the headless terminal's active buffer. */
function readRenderedLines(term: TerminalInstance): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i <= buf.baseY + buf.cursorY; i++) {
    const line = buf.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  return lines;
}

// --- Extracted helpers for startSession ---

function createPtyProcess(projectPath: string, args: string[] = []): pty.IPty {
  const extraPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  const fullPath = [...extraPaths, process.env.PATH].join(':');

  return pty.spawn(CLAUDE_BINARY, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: projectPath,
    env: { ...process.env, TERM: 'xterm-256color', PATH: fullPath },
  });
}

function setupDataHandler(session: ClaudeSession, io: SocketIOServer | null, room: string, emitStatus: (s: SessionStatus) => void): void {
  session.pty.onData((data: string) => {
    // Feed raw data to headless terminal for proper screen emulation
    session.headlessTerminal.write(data);

    // Keep raw buffer for client replay
    session.buffer += data;
    if (session.buffer.length > MAX_BUFFER_SIZE) {
      session.buffer = session.buffer.slice(-MAX_BUFFER_SIZE);
    }

    if (session.currentPromptId) {
      session.responseBuffer += data;
    }

    if (io) {
      io.to(room).emit('claude:output', {
        chatId: session.chatId,
        data,
        promptId: session.currentPromptId,
      });
    }

    // Silence-based detection
    if (session.silenceTimer) clearTimeout(session.silenceTimer);
    session.silenceTimer = setTimeout(() => {
      const renderedLines = readRenderedLines(session.headlessTerminal);
      const { sessionStatus, interactive } = analyzeBuffer(renderedLines, session.startupComplete);

      if (!session.startupComplete) {
        if (sessionStatus === 'idle') {
          session.startupComplete = true;
          emitStatus('idle');
        }
      } else if (session.currentPromptId) {
        // Don't let the buffer analyzer revert waiting-input back to thinking.
        // During user interaction the buffer can be messy from cursor navigation,
        // causing detectSessionStatus to fall back to 'thinking' incorrectly.
        // Only explicit user actions (confirmAction, sendPrompt) should set thinking.
        if (!(session.status === 'waiting-input' && sessionStatus === 'thinking')) {
          emitStatus(sessionStatus);
        }
      }

      // Emit interactive state changes to client
      if (io && session.startupComplete) {
        const prevJson = JSON.stringify(session.lastInteractiveState);
        const newJson = JSON.stringify(interactive);
        if (prevJson !== newJson) {
          // During waiting-input, don't clear the interactive state to null.
          // The detector can be unreliable during cursor navigation in menus —
          // keep the last known state until a concrete new state is detected
          // or the status changes (which clears it on the client).
          if (session.status === 'waiting-input' && session.lastInteractiveState && !interactive) {
            // Keep the last interactive state — detection probably just failed
          } else {
            session.lastInteractiveState = interactive;
            io.to(room).emit('claude:interactive', { chatId: session.chatId, interactive });
          }
        }
      }
    }, 500);
  });
}

function setupExitHandler(session: ClaudeSession, io: SocketIOServer | null, room: string): void {
  session.pty.onExit(({ exitCode }) => {
    session.status = 'exited';
    if (session.silenceTimer) clearTimeout(session.silenceTimer);
    if (io) {
      io.to(room).emit('claude:status', { chatId: session.chatId, status: 'exited', exitCode });
    }
    sessions.delete(session.chatId);
  });
}

// --- Main API ---

interface StartSessionOptions {
  /** Pass --resume <id> to resume a specific CLI session */
  resumeSessionId?: string;
  /** Pass --session-id <id> to start a new CLI session with a known ID */
  sessionId?: string;
}

function startSession(chatId: string, projectId: string, projectPath: string, io: SocketIOServer | null, options?: StartSessionOptions): ClaudeSession {
  endSession(chatId);

  const args: string[] = [];
  if (options?.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  } else if (options?.sessionId) {
    args.push('--session-id', options.sessionId);
  }

  const ptyProcess = createPtyProcess(projectPath, args);
  const headlessTerminal = new Terminal({ cols: 120, rows: 30, allowProposedApi: true });

  const session: ClaudeSession = {
    pty: ptyProcess,
    headlessTerminal,
    status: 'starting',
    projectId,
    chatId,
    buffer: '',
    responseBuffer: '',
    currentPromptId: null,
    silenceTimer: null,
    startupComplete: false,
    lastInteractiveState: null,
  };

  sessions.set(chatId, session);

  const room = `claude:${chatId}`;

  function emitStatus(newStatus: SessionStatus): void {
    if (session.status === newStatus) return;
    const prevStatus = session.status;
    session.status = newStatus;
    console.log(`[claude:${chatId}] status: ${prevStatus} -> ${newStatus}`);

    if (io) {
      io.to(room).emit('claude:status', { chatId, status: newStatus });

      // If transitioning from thinking to idle with an active prompt, response is complete
      if (newStatus === 'idle' && prevStatus === 'thinking' && session.currentPromptId) {
        io.to(room).emit('claude:response-complete', {
          chatId,
          promptId: session.currentPromptId,
          response: session.responseBuffer,
        });
        session.currentPromptId = null;
        session.responseBuffer = '';
      }
    }
  }

  setupDataHandler(session, io, room, emitStatus);
  setupExitHandler(session, io, room);

  // Fallback: if after 8 seconds we still haven't detected idle, force it
  setTimeout(() => {
    if (!session.startupComplete && session.status === 'starting') {
      console.log(`[claude:${chatId}] Startup timeout - forcing idle`);
      session.startupComplete = true;
      emitStatus('idle');
    }
  }, 8000);

  return session;
}

function sendPrompt(chatId: string, promptText: string, promptId: string): { success?: boolean; error?: string } {
  const session = sessions.get(chatId);
  if (!session || session.status === 'exited') {
    return { error: 'Session not active' };
  }

  session.currentPromptId = promptId;
  session.responseBuffer = '';
  session.status = 'thinking';

  if (session.pty) {
    session.pty.write(promptText);
    setTimeout(() => {
      session.pty.write('\r');
    }, 100);
  }

  return { success: true };
}

function cancelPrompt(chatId: string): void {
  const session = sessions.get(chatId);
  if (!session) return;

  session.pty.write('\x03'); // Ctrl+C
  session.currentPromptId = null;
  session.responseBuffer = '';

  setTimeout(() => {
    if (session.status === 'thinking') {
      session.status = 'idle';
    }
  }, 1000);
}

function confirmAction(chatId: string, answer: string): void {
  const session = sessions.get(chatId);
  if (!session) return;

  session.pty.write(answer);
  setTimeout(() => {
    session.pty.write('\r');
  }, 100);
  session.status = 'thinking';
}

function typeText(chatId: string, text: string): { success?: boolean; error?: string } {
  const session = sessions.get(chatId);
  if (!session || session.status === 'exited') return { error: 'Session not active' };

  try {
    session.pty.write(text);
  } catch (err) {
    console.error(`[claude:${chatId}] typeText write error:`, err);
    return { error: 'Failed to write to PTY' };
  }
  return { success: true };
}

function sendKeySequence(chatId: string, key: AllowedKey): { success?: boolean; error?: string } {
  const session = sessions.get(chatId);
  if (!session || session.status === 'exited') return { error: 'Session not active' };

  const sequence = KEY_MAP[key];
  if (!sequence) return { error: 'Invalid key' };

  try {
    session.pty.write(sequence);
  } catch (err) {
    console.error(`[claude:${chatId}] sendKeySequence write error:`, err);
    return { error: 'Failed to write to PTY' };
  }
  return { success: true };
}

function endSession(chatId: string): void {
  const session = sessions.get(chatId);
  if (!session) return;

  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  session.headlessTerminal.dispose();

  try {
    session.pty.write('/exit');
    setTimeout(() => {
      session.pty.write('\r');
    }, 100);
    setTimeout(() => {
      try {
        session.pty.kill('SIGKILL');
      } catch {
        // Already dead
      }
    }, 3000);
  } catch {
    // Already dead
  }

  sessions.delete(chatId);
}

function getSession(chatId: string): ClaudeSession | null {
  return sessions.get(chatId) || null;
}

function getBuffer(chatId: string): string {
  const session = sessions.get(chatId);
  return session ? session.buffer : '';
}

function endAllSessions(): void {
  for (const [chatId] of sessions) {
    endSession(chatId);
  }
}

export default {
  startSession,
  sendPrompt,
  cancelPrompt,
  confirmAction,
  typeText,
  sendKeySequence,
  endSession,
  getSession,
  getBuffer,
  endAllSessions,
};
