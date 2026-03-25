import { randomUUID } from 'node:crypto';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import pty, { type IPty } from 'node-pty';
import projectManager from '../services/projectManager.ts';
import processManager from '../services/processManager.ts';
import type {
  CCStartPayload,
  CCInputPayload,
  CCResizePayload,
  CCStopPayload,
  CCAttachPayload,
  CCDetachPayload,
} from '../../shared/types/socket-events.ts';

const MAX_BUFFER_LINES = 5000;

// Env vars set by the dashboard that should NOT leak into child processes
const DASHBOARD_ENV_KEYS = ['PORT', 'TUNNEL_API_KEY', 'TUNNEL_USER_SUBDOMAIN', 'SESSION_SECRET', 'TUNNEL_MODE', 'NGROK_AUTHTOKEN', 'TUNNEL_SERVICE_URL'];

// Claude Code CLI spinner characters (from Gc_ in the CLI source).
// The CLI animates through these when thinking/processing:
//   · → ✢ → ✳ → ✶ → ✻ → ✽ → (reverse)
// We match any of the non-trivial spinner chars (skip ·, it's too common).
const CC_SPINNER_CHARS = new Set(['\u2722', '\u2733', '\u2736', '\u273B', '\u273D']); // ✢✳✶✻✽

// Idle timeout: if no spinner char seen for this long, assume idle
const THINKING_IDLE_MS = 600;

function getChildEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of DASHBOARD_ENV_KEYS) {
    delete env[key];
  }
  env.TERM = 'xterm-256color';
  return env;
}

interface CCSession {
  pty: IPty;
  buffer: string[];
  status: 'running' | 'exited';
  chatId: string;
  projectId: string;
  exitCode: number | null;
  isThinking: boolean;
  thinkingTimer: ReturnType<typeof setTimeout> | null;
}

// Map<chatId, CCSession>
const sessions = new Map<string, CCSession>();

// Throttle map for touchChatActivity: chatId -> last touch timestamp
const lastActivityTouch = new Map<string, number>();

export default function registerClaudeCodeEvents(socket: Socket, io: SocketIOServer): void {

  socket.on('cc:start', ({ projectId, chatId, conversationId, cols, rows }: CCStartPayload) => {
    try {
      // Kill existing session for this chat if any
      killSession(chatId);

      const projectPath = projectManager.getProjectPath(projectId);

      // Build claude command args
      const args = ['--dangerously-skip-permissions'];
      let sessionId = conversationId;
      if (sessionId) {
        args.push('--resume', sessionId);
      } else {
        // Generate a new session ID so we can resume later
        sessionId = randomUUID();
        args.push('--session-id', sessionId);
        projectManager.updateChat(chatId, { ccConversationId: sessionId });
      }

      const ptyProcess = pty.spawn('claude', args, {
        name: 'xterm-256color',
        cols: cols || 120,
        rows: rows || 30,
        cwd: projectPath,
        env: getChildEnv(),
      });

      const buffer: string[] = [];
      const session: CCSession = {
        pty: ptyProcess,
        buffer,
        status: 'running',
        chatId,
        projectId,
        exitCode: null,
        isThinking: false,
        thinkingTimer: null,
      };

      sessions.set(chatId, session);

      // Register with processManager for port detection
      processManager.registerExternalProcess({
        projectId,
        scriptId: `cc-${chatId}`,
        chatId,
        pty: ptyProcess,
        command: 'claude',
        label: 'Claude Code',
        io,
      });

      const room = `cc:${chatId}`;
      socket.join(room);

      // Stream output to clients + detect thinking state from spinner chars
      ptyProcess.onData((data: string) => {
        buffer.push(data);
        if (buffer.length > MAX_BUFFER_LINES) {
          buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
        }
        io.to(room).emit('cc:output', { chatId, data });

        // Check if data contains any Claude Code spinner characters
        let hasSpinner = false;
        for (const ch of data) {
          if (CC_SPINNER_CHARS.has(ch)) {
            hasSpinner = true;
            break;
          }
        }

        if (hasSpinner) {
          // Spinner detected → thinking
          if (!session.isThinking) {
            session.isThinking = true;
            io.to(room).emit('cc:thinking', { chatId, isThinking: true });
            io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: 'thinking' });
          }
          // Reset idle timer
          if (session.thinkingTimer) clearTimeout(session.thinkingTimer);
          session.thinkingTimer = setTimeout(() => {
            if (session.isThinking) {
              session.isThinking = false;
              io.to(room).emit('cc:thinking', { chatId, isThinking: false });
              io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: 'idle' });
            }
          }, THINKING_IDLE_MS);
        }
      });

      // Handle process exit
      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (session.thinkingTimer) clearTimeout(session.thinkingTimer);
        session.isThinking = false;
        session.status = 'exited';
        session.exitCode = exitCode;
        io.to(room).emit('cc:exit', { chatId, exitCode });
        io.to(room).emit('cc:status', { chatId, status: 'exited' });
        // Notify project room so chat list shows updated status
        io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: 'exited' });
      });

      // Emit running status to chat room and project room
      io.to(room).emit('cc:status', { chatId, status: 'running' });
      io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: 'idle' });
    } catch (err: any) {
      console.error('cc:start error:', err);
      socket.emit('cc:status', { chatId, status: 'error' });
      socket.emit('cc:error', { chatId, error: err.message });
      io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: 'exited' });
    }
  });

  socket.on('cc:input', ({ chatId, data }: CCInputPayload) => {
    const session = sessions.get(chatId);
    if (session && session.status === 'running') {
      session.pty.write(data);

      // Touch last_activity_at when user presses Enter (throttled to every 10s)
      if (data.includes('\r') || data.includes('\n')) {
        const now = Date.now();
        const lastTouch = lastActivityTouch.get(chatId) || 0;
        if (now - lastTouch > 10_000) {
          lastActivityTouch.set(chatId, now);
          projectManager.touchChatActivity(chatId);
        }
      }
    }
  });

  socket.on('cc:resize', ({ chatId, cols, rows }: CCResizePayload) => {
    const session = sessions.get(chatId);
    if (session && session.status === 'running') {
      try {
        session.pty.resize(cols, rows);
      } catch {
        // ignore resize errors
      }
    }
  });

  socket.on('cc:stop', ({ chatId }: CCStopPayload) => {
    killSession(chatId);
  });

  socket.on('cc:attach', ({ chatId, cols, rows }: CCAttachPayload) => {
    const room = `cc:${chatId}`;
    socket.join(room);

    const session = sessions.get(chatId);
    if (session) {
      // Resize PTY to match the client terminal before replaying buffer
      if (cols && rows && session.status === 'running') {
        try { session.pty.resize(cols, rows); } catch {}
      }
      // Replay buffer
      const fullBuffer = session.buffer.join('');
      if (fullBuffer) {
        socket.emit('cc:output', { chatId, data: fullBuffer });
      }
      // Send current status
      socket.emit('cc:status', { chatId, status: session.status });
      // Send current thinking state
      socket.emit('cc:thinking', { chatId, isThinking: session.isThinking });
    }
  });

  socket.on('cc:detach', ({ chatId }: CCDetachPayload) => {
    const room = `cc:${chatId}`;
    socket.leave(room);
  });

  socket.on('cc:check-session', ({ chatId }: { chatId: string }, callback?: (result: { exists: boolean; status?: string }) => void) => {
    const session = sessions.get(chatId);
    if (callback) {
      callback({
        exists: !!session,
        status: session?.status,
      });
    }
  });
}

function killSession(chatId: string): void {
  const session = sessions.get(chatId);
  if (!session || session.status !== 'running') return;

  if (session.thinkingTimer) clearTimeout(session.thinkingTimer);
  session.isThinking = false;

  // Unregister from processManager before killing
  processManager.unregisterExternalProcess(session.projectId, `cc-${chatId}`);

  try {
    session.pty.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (session.status === 'running') {
          session.pty.kill('SIGKILL');
        }
      } catch {
        // Process already dead
      }
    }, 3000);
  } catch {
    // Process already dead
  }

  session.status = 'exited';
}

export function killAllCCSessions(): void {
  for (const [chatId] of sessions) {
    killSession(chatId);
  }
  sessions.clear();
}

/** Return active CC session statuses for a project (for project:join initial payload) */
export function getProjectCCSessions(projectId: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [chatId, session] of sessions) {
    if (session.projectId === projectId && session.status === 'running') {
      result[chatId] = session.isThinking ? 'thinking' : 'idle';
    }
  }
  return result;
}
