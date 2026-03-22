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
}

// Map<chatId, CCSession>
const sessions = new Map<string, CCSession>();

export default function registerClaudeCodeEvents(socket: Socket, io: SocketIOServer): void {

  socket.on('cc:start', ({ projectId, chatId, conversationId }: CCStartPayload) => {
    try {
      // Kill existing session for this chat if any
      killSession(chatId);

      const projectPath = projectManager.getProjectPath(projectId);

      // Build claude command args
      const args = ['--dangerously-skip-permissions'];
      if (conversationId) {
        args.push('--resume', conversationId);
      }

      const ptyProcess = pty.spawn('claude', args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
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

      // Stream output to clients
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
      });

      // Emit running status
      io.to(room).emit('cc:status', { chatId, status: 'running' });
    } catch (err: any) {
      console.error('cc:start error:', err);
      socket.emit('cc:status', { chatId, status: 'error' });
      socket.emit('cc:error', { chatId, error: err.message });
    }
  });

  socket.on('cc:input', ({ chatId, data }: CCInputPayload) => {
    const session = sessions.get(chatId);
    if (session && session.status === 'running') {
      session.pty.write(data);
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

  socket.on('cc:attach', ({ chatId }: CCAttachPayload) => {
    const room = `cc:${chatId}`;
    socket.join(room);

    const session = sessions.get(chatId);
    if (session) {
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
