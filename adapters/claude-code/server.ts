/**
 * Claude Code server adapter.
 *
 * Wraps the existing PTY-based Claude Code session management from
 * server/sockets/claude-code.ts behind the IChatAdapterServer interface.
 * Emits standardized events consumed by wire-events.ts.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty, { type IPty } from 'node-pty';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { IChatAdapterServer, AdapterStartParams, AdapterSession } from '../../server/adapters/types.ts';
import type { SessionStateContext } from '../../shared/types/session.ts';
import type { PrerequisiteResult } from '../../shared/types/adapter.ts';
import manifest from './manifest.ts';
import projectManager from '../../server/services/projectManager.ts';
import processManager, { killProcessTree } from '../../server/services/processManager.ts';
import jsonlWatcher, { readFirstUserPrompt } from '../../server/services/jsonlWatcher.ts';

const MAX_BUFFER_LINES = 50000;
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

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
  inputBuffer: string;
  hasAutoRenamed: boolean;
}

function detectActualSessionId(
  pid: number,
  expectedSessionId: string,
  onMismatch: (actualSessionId: string) => void,
): void {
  const sessionFile = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
  let attempts = 0;
  const maxAttempts = 25;

  const timer = setInterval(() => {
    attempts++;
    try {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      clearInterval(timer);
      if (data.sessionId && data.sessionId !== expectedSessionId) {
        onMismatch(data.sessionId);
      }
    } catch {
      if (attempts >= maxAttempts) clearInterval(timer);
    }
  }, 200);
}

// Throttle map for touchChatActivity
const lastActivityTouch = new Map<string, number>();

export default class ClaudeCodeAdapter extends EventEmitter implements IChatAdapterServer {
  readonly metadata = manifest;
  private sessions = new Map<string, CCSession>();

  async start(params: AdapterStartParams): Promise<AdapterSession> {
    const { chatId, projectId, projectPath, io, sessionId: requestedSessionId, cols, rows } = params;

    // Kill existing session for this chat if any
    this.stop(chatId);

    // Build claude command args
    const args = ['--dangerously-skip-permissions'];
    let sessionId = requestedSessionId;
    if (!sessionId) {
      const chat = projectManager.getChat(chatId);
      sessionId = chat?.sessionId || chat?.ccConversationId || undefined;
    }

    if (sessionId) {
      const encodedPath = projectPath.replace(/\//g, '-');
      const jsonlFile = path.join(os.homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`);
      if (fs.existsSync(jsonlFile)) {
        args.push('--resume', sessionId);
      } else {
        sessionId = randomUUID();
        args.push('--session-id', sessionId);
        projectManager.updateChat(chatId, { ccConversationId: sessionId, sessionId });
      }
    } else {
      sessionId = randomUUID();
      args.push('--session-id', sessionId);
      projectManager.updateChat(chatId, { ccConversationId: sessionId, sessionId });
    }

    const ptyProcess = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 30,
      cwd: projectPath,
      env: params.env || getChildEnv(),
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

    this.sessions.set(chatId, session);

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

    // Start JSONL watcher for this session
    if (sessionId) {
      jsonlWatcher.watchSession(sessionId, projectPath);
      session.jsonlSessionId = sessionId;

      const stateHandler = (sid: string, newState: SessionStateContext, prevState: SessionStateContext) => {
        if (sid !== session.jsonlSessionId) return;
        this.emit('state-change', chatId, projectId, newState, prevState);
      };

      jsonlWatcher.on('state-change', stateHandler);
      session.jsonlStateHandler = stateHandler;

      // Detect if Claude assigned a different session ID
      if (requestedSessionId) {
        detectActualSessionId(ptyProcess.pid, sessionId, (actualId) => {
          const current = this.sessions.get(chatId);
          if (!current || current.pty !== ptyProcess) return;

          jsonlWatcher.unwatchSession(sessionId!);
          jsonlWatcher.watchSession(actualId, projectPath);
          session.jsonlSessionId = actualId;
          this.emit('session-id', chatId, actualId);
        });
      }
    }

    // Stream PTY output
    ptyProcess.onData((data: string) => {
      const current = this.sessions.get(chatId);
      if (current && current !== session) return;

      buffer.push(data);
      if (buffer.length > MAX_BUFFER_LINES) {
        buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
      }
      this.emit('output', chatId, data);
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      const current = this.sessions.get(chatId);
      if (current && current !== session) return;

      session.status = 'exited';
      session.exitCode = exitCode;
      this.emit('exit', chatId, projectId, exitCode);
    });

    // Emit starting state
    this.emit('state-change', chatId, projectId, { status: 'starting' } as SessionStateContext, {} as SessionStateContext);

    return { chatId, projectId, status: 'running' };
  }

  stop(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session || session.status !== 'running') return;

    if (session.jsonlSessionId) {
      jsonlWatcher.unwatchSession(session.jsonlSessionId);
    }
    if (session.jsonlStateHandler) {
      jsonlWatcher.off('state-change', session.jsonlStateHandler);
    }

    processManager.unregisterExternalProcess(session.projectId, `cc-${chatId}`);
    killProcessTree(session.pty);
    session.status = 'exited';
  }

  attach(chatId: string, socket: Socket, options?: { cols?: number; rows?: number }): void {
    const room = `cc:${chatId}`;
    socket.join(room);

    const session = this.sessions.get(chatId);
    if (session) {
      if (options?.cols && options?.rows && session.status === 'running') {
        try { session.pty.resize(options.cols, options.rows); } catch {}
      }
      const fullBuffer = session.buffer.join('');
      if (fullBuffer) {
        socket.emit('cc:output', { chatId, data: fullBuffer });
      }
      socket.emit('cc:status', { chatId, status: session.status });
    }
  }

  detach(chatId: string, socket: Socket): void {
    socket.leave(`cc:${chatId}`);
  }

  checkSession(chatId: string): { exists: boolean; status?: string } {
    const session = this.sessions.get(chatId);
    return { exists: !!session, status: session?.status };
  }

  endAll(): void {
    for (const [chatId] of this.sessions) {
      this.stop(chatId);
    }
    this.sessions.clear();
  }

  sendInput(chatId: string, input: string | Record<string, unknown>): void {
    const data = typeof input === 'string' ? input : JSON.stringify(input);
    const session = this.sessions.get(chatId);
    if (!session || session.status !== 'running') return;

    // Bracketed paste for multi-line input
    if (data.includes('\n')) {
      const stripped = data.endsWith('\r') ? data.slice(0, -1) : data;
      session.pty.write(`\x1b[200~${stripped}\x1b[201~`);
      setTimeout(() => {
        if (session.status === 'running') {
          session.pty.write('\r');
        }
      }, 150);
    } else {
      session.pty.write(data);
    }

    // Clear working signal on SIGINT / Escape
    if ((data === '\x03' || data === '\x1b') && session.jsonlSessionId) {
      jsonlWatcher.clearWorkingSignal(session.jsonlSessionId);
    }

    // Auto-title on first user Enter
    if (!session.hasAutoRenamed) {
      session.inputBuffer += data;
      if (data.includes('\r') || data.includes('\n')) {
        session.hasAutoRenamed = true;
        const promptText = session.inputBuffer
          .split(/[\r\n]/)[0]
          .replace(/\x1b\[[^A-Za-z]*[A-Za-z]/g, '')
          .replace(/[\x00-\x1f\x7f]/g, '')
          .trim();

        if (promptText && !promptText.startsWith('/')) {
          this.emit('title-hint', chatId, session.projectId, promptText);
        } else {
          // Fall back to JSONL with retries
          const projectPath = projectManager.getProjectPath(session.projectId);
          const sid = session.jsonlSessionId;
          if (sid && projectPath) {
            const tryRename = (attempts: number) => {
              if (attempts <= 0) return;
              const firstPrompt = readFirstUserPrompt(sid, projectPath);
              if (firstPrompt) {
                this.emit('title-hint', chatId, session.projectId, firstPrompt);
              } else {
                setTimeout(() => tryRename(attempts - 1), 2000);
              }
            };
            setTimeout(() => tryRename(3), 1000);
          }
        }
      }
    }

    // Touch last_activity_at on Enter (throttled)
    if (data.includes('\r') || data.includes('\n')) {
      const now = Date.now();
      const lastTouch = lastActivityTouch.get(chatId) || 0;
      if (now - lastTouch > 10_000) {
        lastActivityTouch.set(chatId, now);
        projectManager.touchChatActivity(chatId);
      }
    }
  }

  resize(chatId: string, cols: number, rows: number): void {
    const session = this.sessions.get(chatId);
    if (session && session.status === 'running') {
      try { session.pty.resize(cols, rows); } catch {}
    }
  }

  getSessionState(chatId: string): SessionStateContext | null {
    const session = this.sessions.get(chatId);
    if (!session || session.status !== 'running' || !session.jsonlSessionId) return null;
    return jsonlWatcher.getState(session.jsonlSessionId) || null;
  }

  getProjectSessionStates(projectId: string): Record<string, SessionStateContext> {
    const result: Record<string, SessionStateContext> = {};
    for (const [chatId, session] of this.sessions) {
      if (session.projectId === projectId && session.status === 'running') {
        const state = session.jsonlSessionId ? jsonlWatcher.getState(session.jsonlSessionId) : null;
        if (state) result[chatId] = state;
      }
    }
    return result;
  }

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    try {
      const { execSync } = await import('node:child_process');
      execSync('which claude', { stdio: 'ignore' });
      return { satisfied: true };
    } catch {
      return {
        satisfied: false,
        message: 'Claude CLI is not installed or not on PATH',
        installHint: 'npm install -g @anthropic-ai/claude-code',
      };
    }
  }
}
