/**
 * Adapter Orchestrator — routes unified chat:* socket events to the correct adapter.
 *
 * This runs alongside the existing cc:* and sdk:* handlers during migration.
 * Once the frontend fully migrates to chat:* events, the old handlers can be removed.
 */

import type { Socket, Server as SocketIOServer } from 'socket.io';
import { adapterRegistry } from '../adapters/registry.ts';
import projectManager from '../services/projectManager.ts';
import type { SessionStateContext } from '../../shared/types/session.ts';

export default function registerAdapterOrchestrator(socket: Socket, io: SocketIOServer): void {

  // ── chat:start — start or resume a session ──
  socket.on('chat:start', async ({ projectId, chatId, sessionId, cols, rows }: {
    projectId: string;
    chatId: string;
    sessionId?: string;
    cols?: number;
    rows?: number;
  }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) {
      socket.emit('chat:error', { chatId, error: 'Chat not found' });
      return;
    }

    const adapter = adapterRegistry.get(chat.adapter);
    if (!adapter) {
      socket.emit('chat:error', { chatId, error: `Unknown adapter: ${chat.adapter}` });
      return;
    }

    try {
      const projectPath = projectManager.getProjectPath(projectId);
      await adapter.start({ chatId, projectId, projectPath, io, sessionId, cols, rows });
    } catch (err: any) {
      console.error(`chat:start error [${chat.adapter}]:`, err);
      socket.emit('chat:error', { chatId, error: err.message });
    }
  });

  // ── chat:input — send user input ──
  socket.on('chat:input', ({ chatId, data }: { chatId: string; data: string }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.sendInput(chatId, data);
  });

  // ── chat:stop — stop/kill a session ──
  socket.on('chat:stop', ({ chatId }: { chatId: string }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.stop(chatId);
  });

  // ── chat:attach / chat:detach — join/leave output stream ──
  socket.on('chat:attach', ({ chatId, cols, rows }: { chatId: string; cols?: number; rows?: number }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.attach(chatId, socket, { cols, rows });
  });

  socket.on('chat:detach', ({ chatId }: { chatId: string }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.detach(chatId, socket);
  });

  // ── chat:resize — resize terminal ──
  socket.on('chat:resize', ({ chatId, cols, rows }: { chatId: string; cols: number; rows: number }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.resize(chatId, cols, rows);
  });

  // ── chat:check-session — check if a session exists ──
  socket.on('chat:check-session', ({ chatId }: { chatId: string }, callback?: (result: { exists: boolean; status?: string }) => void) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) {
      callback?.({ exists: false });
      return;
    }
    const result = adapterRegistry.get(chat.adapter)?.checkSession(chatId);
    callback?.(result || { exists: false });
  });

  // ── chat:permission-response — respond to a permission request ──
  socket.on('chat:permission-response', ({ chatId, requestId, granted }: {
    chatId: string;
    requestId: string;
    granted: boolean;
  }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.resolvePermission?.(chatId, requestId, granted);
  });

  // ── chat:question-response — respond to a question ──
  socket.on('chat:question-response', ({ chatId, requestId, answers }: {
    chatId: string;
    requestId: string;
    answers: Record<number, string[]>;
  }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.resolveQuestion?.(chatId, requestId, answers);
  });

  // ── chat:interrupt — interrupt current operation ──
  socket.on('chat:interrupt', ({ chatId }: { chatId: string }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.interrupt?.(chatId);
  });

  // ── chat:adapter-event — passthrough for adapter-specific custom events ──
  socket.on('chat:adapter-event', ({ chatId, event, data }: {
    chatId: string;
    event: string;
    data: unknown;
  }) => {
    const chat = projectManager.getChat(chatId);
    if (!chat) return;
    adapterRegistry.get(chat.adapter)?.handleCustomEvent?.(chatId, event, data);
  });

  // ── project:join — merge states from all adapters ──
  // NOTE: This is also handled by the existing sdk handler for backward compat.
  // The unified version will replace it once migration is complete.
  socket.on('chat:project-join', ({ projectId }: { projectId: string }, callback?: Function) => {
    socket.join(`project:${projectId}`);
    const sessionStates: Record<string, SessionStateContext> = {};
    for (const [, adapter] of adapterRegistry.entries()) {
      Object.assign(sessionStates, adapter.getProjectSessionStates(projectId));
    }
    callback?.(sessionStates);
  });
}
