import pty from 'node-pty';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { detectInteractiveState } from './interactiveDetector.js';

const MAX_BUFFER_SIZE = 50000;

// Resolve the full path to the claude binary
function findClaudeBinary() {
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

// Map<string, ClaudeSession>
const sessions = new Map();

// Strip ANSI escape codes for prompt detection
function stripAnsi(str) {
  return str
    // CSI sequences: \x1b[ optionally followed by ? or > then digits/semicolons then letter
    .replace(/\x1b\[[\?>=!]?[0-9;]*[a-zA-Z]/g, '')
    // OSC sequences: \x1b] ... BEL or ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // Other escape sequences (SS2, SS3, DCS, etc.)
    .replace(/\x1b[^[\]](.*?)(\x1b\\|\x07)/g, '')
    // Single-character escapes
    .replace(/\x1b[()#][A-Z0-9]/g, '')
    // Any remaining lone ESC + single char
    .replace(/\x1b[A-Z@\[\\\]^_`a-z{|}~]/g, '')
    // Control characters (except newline)
    .replace(/[\x00-\x09\x0b-\x1f]/g, '');
}

function detectState(rawBuffer) {
  const clean = stripAnsi(rawBuffer.slice(-2000));
  const lastLines = clean.trim().split('\n').filter(l => l.trim());
  const lastLine = (lastLines[lastLines.length - 1] || '').trim();

  // Confirmation patterns
  const confirmPatterns = [
    /\(y\/n\)/i,
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /Continue\?/i,
    /Apply changes\?/i,
    /Do you want to proceed\?/i,
    /Proceed\?/i,
  ];

  for (const pattern of confirmPatterns) {
    if (pattern.test(lastLine)) {
      return 'waiting-confirmation';
    }
  }

  // Check if an interactive element (selection menu, permission prompt) is active.
  // These also use ❯ / > markers and box-drawing characters, so we must detect
  // them BEFORE the idle-prompt check to avoid false positives.
  const recentText = lastLines.slice(-10).join(' ');
  const hasBoxDrawing = /[│┌┐└┘─╭╮╯╰┃┏┓┗┛━]/.test(recentText);
  const hasPermissionKeyword = /\b(allow|deny|permission|approve|bash|edit|write|read)\b/i.test(recentText);
  if (hasBoxDrawing && hasPermissionKeyword) {
    return 'waiting-confirmation';
  }

  // Check for selection menu markers: multiple lines with one ❯-prefixed item
  // among other plain items (this is a menu, not the idle prompt)
  const menuLines = lastLines.slice(-15);
  const markerLine = menuLines.findIndex(l => /^\s*[❯›>]\s+\S/.test(l));
  if (markerLine !== -1) {
    // Count contiguous option-like lines around the marker
    let count = 1;
    for (let i = markerLine - 1; i >= 0; i--) {
      if (menuLines[i].trim() && menuLines[i].trim().length < 100) count++;
      else break;
    }
    for (let i = markerLine + 1; i < menuLines.length; i++) {
      if (menuLines[i].trim() && menuLines[i].trim().length < 100) count++;
      else break;
    }
    if (count >= 2) {
      return 'waiting-confirmation';
    }
  }

  // Prompt patterns - Claude Code shows ❯ when ready for input
  // Only match the idle prompt: a lone ❯ on the last line (not part of a menu)
  if (/^[❯›»]\s*$/.test(lastLine)) {
    return 'idle';
  }

  // Also check for the "> " prompt style but only on the very last line
  // and only if it looks like a standalone prompt (short, no other content)
  if (/^>\s*$/.test(lastLine)) {
    return 'idle';
  }

  return 'thinking';
}

function startSession(chatId, projectId, projectPath, io) {
  endSession(chatId);

  const extraPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  const fullPath = [...extraPaths, process.env.PATH].join(':');

  const ptyProcess = pty.spawn(CLAUDE_BINARY, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: projectPath,
    env: { ...process.env, TERM: 'xterm-256color', PATH: fullPath },
  });

  const session = {
    pty: ptyProcess,
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

  function emitStatus(newStatus) {
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

      if (newStatus === 'waiting-confirmation') {
        const clean = stripAnsi(session.buffer.slice(-500));
        const lines = clean.trim().split('\n').filter(l => l.trim());
        io.to(room).emit('claude:confirmation-needed', {
          chatId,
          question: lines[lines.length - 1] || '',
        });
      }
    }
  }

  ptyProcess.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > MAX_BUFFER_SIZE) {
      session.buffer = session.buffer.slice(-MAX_BUFFER_SIZE);
    }

    // Only accumulate response data when there's an active prompt
    if (session.currentPromptId) {
      session.responseBuffer += data;
    }

    if (io) {
      io.to(room).emit('claude:output', {
        chatId,
        data,
        promptId: session.currentPromptId,
      });
    }

    // Use silence-based detection
    clearTimeout(session.silenceTimer);
    session.silenceTimer = setTimeout(() => {
      // Run interactive detection first — if an interactive element is active
      // we must NOT falsely transition to 'idle' (which triggers response-complete)
      const interactive = session.startupComplete
        ? detectInteractiveState(session.buffer)
        : null;

      const detected = detectState(session.buffer);

      if (!session.startupComplete) {
        // During startup, only transition to idle once we detect the prompt
        if (detected === 'idle') {
          session.startupComplete = true;
          emitStatus('idle');
        }
        // Otherwise stay in 'starting'
      } else if (session.currentPromptId) {
        // If an interactive element is detected, Claude is waiting for user input
        // — treat this as waiting-confirmation, never as 'idle'
        if (interactive && detected === 'idle') {
          emitStatus('waiting-confirmation');
        } else {
          emitStatus(detected);
        }
      }
      // If no active prompt, stay in current state (idle)

      // Emit interactive state changes to client
      if (io && session.startupComplete) {
        const prevJson = JSON.stringify(session.lastInteractiveState);
        const newJson = JSON.stringify(interactive);
        if (prevJson !== newJson) {
          session.lastInteractiveState = interactive;
          io.to(room).emit('claude:interactive', { chatId, interactive });
        }
      }
    }, 500);
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.status = 'exited';
    clearTimeout(session.silenceTimer);
    if (io) {
      io.to(room).emit('claude:status', { chatId, status: 'exited', exitCode });
    }
    sessions.delete(chatId);
  });

  // Fallback: if after 8 seconds we still haven't detected idle, force it
  // Claude Code startup can take a while
  setTimeout(() => {
    if (!session.startupComplete && session.status === 'starting') {
      console.log(`[claude:${chatId}] Startup timeout - forcing idle`);
      session.startupComplete = true;
      emitStatus('idle');
    }
  }, 8000);

  return session;
}

function sendPrompt(chatId, promptText, promptId) {
  const session = sessions.get(chatId);
  if (!session || session.status === 'exited') {
    return { error: 'Session not active' };
  }

  session.currentPromptId = promptId;
  session.responseBuffer = '';
  session.status = 'thinking';

  if (session.pty) {
    // Write text first, then send Enter separately so Claude Code's
    // Ink input handler receives them as distinct events
    session.pty.write(promptText);
    setTimeout(() => {
      session.pty.write('\r');
    }, 100);
  }

  return { success: true };
}

function cancelPrompt(chatId) {
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

function confirmAction(chatId, answer) {
  const session = sessions.get(chatId);
  if (!session) return;

  // Write answer then Enter separately for Ink input handler
  session.pty.write(answer);
  setTimeout(() => {
    session.pty.write('\r');
  }, 100);
  session.status = 'thinking';
}

const KEY_MAP = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Enter: '\r',
  Escape: '\x1b',
  Tab: '\t',
  ShiftTab: '\x1b[Z',
};

function sendKeySequence(chatId, key) {
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

function endSession(chatId) {
  const session = sessions.get(chatId);
  if (!session) return;

  clearTimeout(session.silenceTimer);

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

function getSession(chatId) {
  return sessions.get(chatId) || null;
}

function getBuffer(chatId) {
  const session = sessions.get(chatId);
  return session ? session.buffer : '';
}

function endAllSessions() {
  for (const [chatId] of sessions) {
    endSession(chatId);
  }
}

export default {
  startSession,
  sendPrompt,
  cancelPrompt,
  confirmAction,
  sendKeySequence,
  endSession,
  getSession,
  getBuffer,
  endAllSessions,
};
