import { randomUUID } from 'node:crypto';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import pty, { type IPty } from 'node-pty';
import projectManager from '../services/projectManager.ts';
import processManager from '../services/processManager.ts';
import jsonlWatcher, { readFirstUserPrompt } from '../services/jsonlWatcher.ts';
import { generateChatTitle } from '../services/aiTitleGenerator.ts';
import { sendPushEvent } from '../services/tunnelClient.ts';
import type { SessionStateContext } from '../../shared/types/session.ts';
import { mapToLegacyStatus } from '../../shared/types/session.ts';
import type {
  CCStartPayload,
  CCInputPayload,
  CCResizePayload,
  CCStopPayload,
  CCAttachPayload,
  CCDetachPayload,
} from '../../shared/types/socket-events.ts';

const MAX_BUFFER_LINES = 5000;

// Guard: prevent duplicate AI title API calls across the 3 rename paths
const aiTitledChats = new Set<string>();

/** Fire-and-forget AI title generation for a CC chat (deduped per chatId) */
function tryAiTitle(chatId: string, projectId: string, promptText: string, io: SocketIOServer) {
  if (aiTitledChats.has(chatId)) return;
  const project = projectManager.getProject(projectId);
  if (project?.aiNamingEnabled !== 'on') return;
  aiTitledChats.add(chatId);
  generateChatTitle(promptText).then((aiTitle) => {
    if (aiTitle) {
      projectManager.updateChat(chatId, { label: aiTitle });
      io.to(`project:${projectId}`).emit('claude:chat-renamed', { chatId, label: aiTitle });
    }
  }).catch(() => {});
}

// Env vars set by the dashboard that should NOT leak into child processes
const DASHBOARD_ENV_KEYS = ['PORT', 'TUNNEL_API_KEY', 'TUNNEL_USER_SUBDOMAIN', 'SESSION_SECRET', 'TUNNEL_MODE', 'NGROK_AUTHTOKEN', 'TUNNEL_SERVICE_URL'];

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
  jsonlSessionId: string | null;
  jsonlStateHandler: ((...args: any[]) => void) | null;
  /** Accumulates raw PTY input until the first Enter so we can auto-title the chat */
  inputBuffer: string;
  /** True once we've attempted the first-input rename (prevents retries) */
  hasAutoRenamed: boolean;
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
        projectManager.updateChat(chatId, { ccConversationId: sessionId, sessionId });
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
        jsonlSessionId: null,
        jsonlStateHandler: null,
        inputBuffer: '',
        hasAutoRenamed: false,
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

      // Start JSONL watcher for this session — sole source of status detection
      if (sessionId) {
        jsonlWatcher.watchSession(sessionId, projectPath);
        session.jsonlSessionId = sessionId;

        // Subscribe to state changes from JSONL watcher
        const stateHandler = (sid: string, newState: SessionStateContext, prevState: SessionStateContext) => {
          if (sid !== sessionId) return;
          // Emit the unified state event
          io.to(`project:${projectId}`).emit('claude:session-state', { chatId, state: newState });
          // Also emit legacy status for backward compat
          io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: mapToLegacyStatus(newState.status) });

          // Push notifications for CC chats
          if (newState.status === 'question-awaiting' && newState.questions?.[0]) {
            const preview = `Claude asks: ${newState.questions[0].question.slice(0, 80)}`;
            sendPushEvent('chat-question', { preview, chatId });
          } else if (newState.status === 'questions-awaiting' && newState.questions) {
            sendPushEvent('chat-question', { preview: `Claude has ${newState.questions.length} questions`, chatId });
          } else if (newState.status === 'plan-awaiting') {
            sendPushEvent('chat-plan', { preview: 'Plan ready for review', chatId });
          } else if (newState.status === 'permission-awaiting' && newState.pendingTool) {
            sendPushEvent('chat-permission', { preview: `Approve: ${newState.pendingTool.toolName}`, chatId });
          } else if (newState.status === 'working' && prevState.status === 'starting') {
            // Auto-title: rename "New Chat" as soon as the agent starts working on the first prompt
            const chat = projectManager.getChat(chatId);
            if (chat && chat.label === 'New Chat' && sessionId) {
              const firstPrompt = readFirstUserPrompt(sessionId, projectPath);
              if (firstPrompt) {
                const newLabel = firstPrompt.slice(0, 50) + (firstPrompt.length > 50 ? '...' : '');
                projectManager.updateChat(chatId, { label: newLabel });
                io.to(`project:${projectId}`).emit('claude:chat-renamed', { chatId, label: newLabel });
                tryAiTitle(chatId, projectId, firstPrompt, io);
              }
            }
          } else if (newState.status === 'idle' && (prevState.status === 'working' || prevState.status === 'starting')) {
            const preview = newState.lastTextPreview || 'Response ready';
            sendPushEvent('chat-reply', { preview, chatId });
            // Mark unread when agent transitions to idle
            projectManager.markChatUnread(chatId);
            io.to(`project:${projectId}`).emit('chat:unread', { chatId });

            // Auto-title fallback: rename "New Chat" on first completion if not yet renamed
            const chat = projectManager.getChat(chatId);
            if (chat && chat.label === 'New Chat' && sessionId) {
              const firstPrompt = readFirstUserPrompt(sessionId, projectPath);
              if (firstPrompt) {
                const newLabel = firstPrompt.slice(0, 50) + (firstPrompt.length > 50 ? '...' : '');
                projectManager.updateChat(chatId, { label: newLabel });
                io.to(`project:${projectId}`).emit('claude:chat-renamed', { chatId, label: newLabel });
                tryAiTitle(chatId, projectId, firstPrompt, io);
              }
            }
          }
        };

        jsonlWatcher.on('state-change', stateHandler);
        session.jsonlStateHandler = stateHandler;
      }

      // Stream PTY output to clients (no spinner analysis — JSONL watcher handles status)
      ptyProcess.onData((data: string) => {
        buffer.push(data);
        if (buffer.length > MAX_BUFFER_LINES) {
          buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
        }
        io.to(room).emit('cc:output', { chatId, data });
      });

      // Handle process exit
      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        session.status = 'exited';
        session.exitCode = exitCode;
        io.to(room).emit('cc:exit', { chatId, exitCode });
        io.to(room).emit('cc:status', { chatId, status: 'exited' });
        io.to(`project:${projectId}`).emit('claude:session-status', { chatId, status: 'exited' });
        io.to(`project:${projectId}`).emit('claude:session-state', {
          chatId,
          state: { status: 'exited' } as SessionStateContext,
        });
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
      // Wrap multi-line input in bracketed paste sequences so the shell
      // accepts the block instead of showing "[pasted N lines]" and stalling.
      if (data.includes('\n')) {
        const stripped = data.endsWith('\r') ? data.slice(0, -1) : data;
        session.pty.write(`\x1b[200~${stripped}\x1b[201~\r`);
      } else {
        session.pty.write(data);
      }

      // Auto-title: rename "New Chat" on first user Enter
      if (!session.hasAutoRenamed) {
        session.inputBuffer += data;
        if (data.includes('\r') || data.includes('\n')) {
          session.hasAutoRenamed = true;
          // Extract printable text before the first Enter
          const promptText = session.inputBuffer
            .split(/[\r\n]/)[0]
            .replace(/\x1b\[[^A-Za-z]*[A-Za-z]/g, '') // strip ANSI escapes
            .replace(/[\x00-\x1f\x7f]/g, '')           // strip control chars
            .trim();

          const chat = projectManager.getChat(chatId);
          if (chat && chat.label === 'New Chat') {
            if (promptText && !promptText.startsWith('/')) {
              // Mobile sends full text + \r in one chunk — rename immediately
              const newLabel = promptText.slice(0, 50) + (promptText.length > 50 ? '...' : '');
              projectManager.updateChat(chatId, { label: newLabel });
              io.to(`project:${session.projectId}`).emit('claude:chat-renamed', { chatId, label: newLabel });
              tryAiTitle(chatId, session.projectId, promptText, io);
            } else {
              // Desktop sends chars individually — fall back to JSONL with retries
              const projectPath = projectManager.getProjectPath(session.projectId);
              const sid = session.jsonlSessionId;
              if (sid && projectPath) {
                const tryRename = (attempts: number) => {
                  if (attempts <= 0) return;
                  const c = projectManager.getChat(chatId);
                  if (!c || c.label !== 'New Chat') return;
                  const firstPrompt = readFirstUserPrompt(sid, projectPath);
                  if (firstPrompt) {
                    const newLabel = firstPrompt.slice(0, 50) + (firstPrompt.length > 50 ? '...' : '');
                    projectManager.updateChat(chatId, { label: newLabel });
                    io.to(`project:${session.projectId}`).emit('claude:chat-renamed', { chatId, label: newLabel });
                    tryAiTitle(chatId, session.projectId, firstPrompt, io);
                  } else {
                    setTimeout(() => tryRename(attempts - 1), 2000);
                  }
                };
                setTimeout(() => tryRename(3), 1000);
              }
            }
          }
        }
      }

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

  // Clean up JSONL watcher
  if (session.jsonlSessionId) {
    jsonlWatcher.unwatchSession(session.jsonlSessionId);
  }
  if (session.jsonlStateHandler) {
    jsonlWatcher.off('state-change', session.jsonlStateHandler);
  }

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
      const jsonlState = session.jsonlSessionId ? jsonlWatcher.getState(session.jsonlSessionId) : null;
      result[chatId] = jsonlState ? mapToLegacyStatus(jsonlState.status) : 'idle';
    }
  }
  return result;
}

/** Return active CC session JSONL states for a project (unified states) */
export function getProjectCCSessionStates(projectId: string): Record<string, SessionStateContext> {
  const result: Record<string, SessionStateContext> = {};
  for (const [chatId, session] of sessions) {
    if (session.projectId === projectId && session.status === 'running') {
      const state = session.jsonlSessionId ? jsonlWatcher.getState(session.jsonlSessionId) : null;
      if (state) {
        result[chatId] = state;
      }
    }
  }
  return result;
}
