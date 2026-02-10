import fs from 'fs';
import path from 'path';
import os from 'os';
import claudeManager from '../services/claudeManager.ts';
import projectManager from '../services/projectManager.js';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { AllowedKey, StartPayload, SendPayload, ConfirmPayload, KeySequencePayload, AttachPayload, TypePayload } from '../../shared/types/interactive.ts';

/** Check whether a Claude CLI session file exists for the given project + session ID. */
function cliSessionExists(projectPath: string, sessionId: string): boolean {
  const encoded = projectPath.replace(/\//g, '-');
  const sessionFile = path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
  try {
    fs.accessSync(sessionFile);
    return true;
  } catch {
    return false;
  }
}

const ALLOWED_KEYS: AllowedKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab', 'ShiftTab'];

export default function registerClaudeEvents(socket: Socket, io: SocketIOServer): void {
  socket.on('claude:start', async ({ projectId, chatId }: StartPayload) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const room = `claude:${chatId}`;
      socket.join(room);

      // Determine whether to resume or start a new CLI session
      const project = await projectManager.getProject(projectId);
      const chat = (project?.chats || []).find((c: any) => c.id === chatId);
      const hasHistory = !!(chat && chat.history && chat.history.length > 0);

      // Ensure chat has a claudeSessionId (backfill for chats created before this feature)
      if (chat && !chat.claudeSessionId) {
        const { v4: uuidv4 } = await import('uuid');
        chat.claudeSessionId = uuidv4();
        await projectManager.updateProject(projectId, { chats: project.chats });
      }

      const sessionOpts: { resumeSessionId?: string; sessionId?: string } = {};
      if (hasHistory && chat?.claudeSessionId && cliSessionExists(projectPath, chat.claudeSessionId)) {
        // Chat has a matching CLI session file → resume it directly
        sessionOpts.resumeSessionId = chat.claudeSessionId;
      } else if (chat?.claudeSessionId) {
        // New chat or backfilled UUID with no CLI session → start fresh with known ID
        sessionOpts.sessionId = chat.claudeSessionId;
      }

      claudeManager.startSession(chatId, projectId, projectPath, io, sessionOpts);
      socket.emit('claude:status', { chatId, status: 'starting' });
    } catch (err: any) {
      console.error('claude:start error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:send', async ({ chatId, prompt, promptId }: SendPayload) => {
    try {
      const result = claudeManager.sendPrompt(chatId, prompt, promptId);
      if (result.error) {
        socket.emit('claude:error', { chatId, error: result.error });
        return;
      }

      // Save to chat history
      const session = claudeManager.getSession(chatId);
      if (session) {
        const project = await projectManager.getProject(session.projectId);
        if (project) {
          const chat = (project.chats || []).find((c: any) => c.id === chatId);
          if (chat) {
            chat.history.push({
              role: 'user',
              content: prompt,
              timestamp: new Date().toISOString(),
            });
            await projectManager.updateProject(session.projectId, { chats: project.chats });

            // Auto-title: rename "New Chat" after first user message
            if (chat.label === 'New Chat' && chat.history.filter((m: any) => m.role === 'user').length === 1) {
              chat.label = prompt.trim().slice(0, 50) + (prompt.trim().length > 50 ? '...' : '');
              await projectManager.updateProject(session.projectId, { chats: project.chats });
              io.to(`claude:${chatId}`).emit('claude:chat-renamed', { chatId, label: chat.label });
            }
          }
        }
      }
    } catch (err: any) {
      console.error('claude:send error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:cancel', ({ chatId }: { chatId: string }) => {
    claudeManager.cancelPrompt(chatId);
  });

  socket.on('claude:confirm', ({ chatId, answer }: ConfirmPayload) => {
    claudeManager.confirmAction(chatId, answer);
  });

  socket.on('claude:type', ({ chatId, text }: TypePayload) => {
    try {
      const result = claudeManager.typeText(chatId, text);
      if (result?.error) {
        socket.emit('claude:error', { chatId, error: result.error });
      }
    } catch (err: any) {
      console.error('claude:type error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:key-sequence', ({ chatId, key }: KeySequencePayload) => {
    try {
      if (!ALLOWED_KEYS.includes(key)) {
        socket.emit('claude:error', { chatId, error: `Invalid key: ${key}` });
        return;
      }
      const result = claudeManager.sendKeySequence(chatId, key);
      if (result?.error) {
        socket.emit('claude:error', { chatId, error: result.error });
      }
    } catch (err: any) {
      console.error('claude:key-sequence error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:end', ({ chatId }: { chatId: string }) => {
    claudeManager.endSession(chatId);
  });

  socket.on('project:join', ({ projectId }: { projectId: string }, callback?: Function) => {
    socket.join(`project:${projectId}`);
    const statuses = claudeManager.getProjectSessions(projectId);
    callback?.(statuses);
  });

  socket.on('project:leave', ({ projectId }: { projectId: string }) => {
    socket.leave(`project:${projectId}`);
  });

  socket.on('claude:check-session', ({ chatId }: { chatId: string }, callback: Function) => {
    const session = claudeManager.getSession(chatId);
    callback(session ? { exists: true, status: session.status } : { exists: false });
  });

  socket.on('claude:attach', ({ chatId }: AttachPayload) => {
    const room = `claude:${chatId}`;
    socket.join(room);

    const buffer = claudeManager.getBuffer(chatId);
    if (buffer) {
      socket.emit('claude:output', { chatId, data: buffer, promptId: null });
    }

    const session = claudeManager.getSession(chatId);
    if (session) {
      socket.emit('claude:status', { chatId, status: session.status });
    }
  });

  // Save assistant responses to chat history
  socket.on('claude:response-complete', async ({ chatId, response }: { chatId: string; response: string }) => {
    try {
      const session = claudeManager.getSession(chatId);
      if (!session) return;

      const project = await projectManager.getProject(session.projectId);
      if (!project) return;

      const chat = (project.chats || []).find((c: any) => c.id === chatId);
      if (chat) {
        chat.history.push({
          role: 'assistant',
          content: response,
          timestamp: new Date().toISOString(),
        });
        await projectManager.updateProject(session.projectId, { chats: project.chats });
      }
    } catch (err) {
      console.error('Error saving response to history:', err);
    }
  });
}
