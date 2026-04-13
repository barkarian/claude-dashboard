/**
 * Claude Agent SDK server adapter.
 *
 * Wraps the existing SDK session management from server/services/sdkSessionManager.ts
 * and server/sockets/claude-sdk.ts behind the IChatAdapterServer interface.
 * Emits standardized events consumed by wire-events.ts.
 */

import { EventEmitter } from 'node:events';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { IChatAdapterServer, AdapterStartParams, AdapterSession } from '../../server/adapters/types.ts';
import type { SessionStateContext } from '../../shared/types/session.ts';
import type { SDKChatMessage } from '../../shared/types/sdk.ts';
import manifest from './manifest.ts';
import sdkSessionManager from '../../server/services/sdkSessionManager.ts';
import projectManager from '../../server/services/projectManager.ts';
import jsonlWatcher, { readSessionHistory } from '../../server/services/jsonlWatcher.ts';

export default class SDKAdapter extends EventEmitter implements IChatAdapterServer {
  readonly metadata = manifest;
  private jsonlListenerBound = false;

  private bindJsonlListener(io: SocketIOServer): void {
    if (this.jsonlListenerBound) return;
    this.jsonlListenerBound = true;

    jsonlWatcher.on('state-change', (sdkSessionId: string, newState: SessionStateContext, prevState: SessionStateContext) => {
      const match = sdkSessionManager.findChatBySDKSessionId(sdkSessionId);
      if (match) {
        this.emit('state-change', match.chatId, match.projectId, newState, prevState);
      }
    });
  }

  async start(params: AdapterStartParams): Promise<AdapterSession> {
    const { chatId, projectId, projectPath, io, sessionId } = params;

    this.bindJsonlListener(io);

    const chat = projectManager.getChat(chatId);
    const savedSessionId = sessionId || chat?.sessionId || chat?.sdkSessionId || undefined;

    sdkSessionManager.initSession(chatId, projectId, projectPath, io, savedSessionId);

    return { chatId, projectId, status: 'idle' };
  }

  stop(chatId: string): void {
    sdkSessionManager.endSession(chatId);
  }

  attach(chatId: string, socket: Socket): void {
    const room = `claude:${chatId}`;
    socket.join(room);

    const session = sdkSessionManager.getSession(chatId);
    if (session) {
      socket.emit('sdk:status', { chatId, status: session.status });

      const messages = sdkSessionManager.getMessageHistory(chatId);
      if (messages.length > 0) {
        socket.emit('sdk:history', { chatId, messages });
      } else {
        try {
          const chat = projectManager.getChat(chatId);
          const sid = chat?.sessionId || chat?.sdkSessionId;
          if (sid) {
            const projectPath = projectManager.getProjectPath(session.projectId);
            const jsonlMessages = readSessionHistory(sid, projectPath);
            if (jsonlMessages.length > 0) {
              socket.emit('sdk:history', { chatId, messages: jsonlMessages });
            }
          }
        } catch (err: any) {
          console.error('sdk:attach history load error:', err);
        }
      }
    }
  }

  detach(chatId: string, socket: Socket): void {
    socket.leave(`claude:${chatId}`);
  }

  checkSession(chatId: string): { exists: boolean; status?: string } {
    const session = sdkSessionManager.getSession(chatId);
    return session ? { exists: true, status: session.status } : { exists: false };
  }

  endAll(): void {
    sdkSessionManager.endAllSessions();
  }

  async sendInput(chatId: string, input: string | Record<string, unknown>): Promise<void> {
    const prompt = typeof input === 'string' ? input : (input as any).prompt || '';
    const session = sdkSessionManager.getSession(chatId);

    if (session) {
      // Emit title-hint on first user message
      const chat = projectManager.getChat(chatId);
      if (chat && chat.label === 'New Chat') {
        const runtimeMessages = sdkSessionManager.getMessageHistory(chatId);
        const userMsgCount = runtimeMessages.filter(m => m.role === 'user').length;
        if (userMsgCount === 0) {
          this.emit('title-hint', chatId, session.projectId, prompt);
        }
      }
    }

    const result = await sdkSessionManager.sendPrompt(chatId, prompt);
    if (result.error) {
      this.emit('error', chatId, result.error);
      return;
    }

    // Post-completion: persist session ID
    if (session) {
      const updatedSession = sdkSessionManager.getSession(chatId);
      const currentChat = projectManager.getChat(chatId);
      if (updatedSession?.sdkSessionId && currentChat?.sdkSessionId !== updatedSession.sdkSessionId) {
        this.emit('session-id', chatId, updatedSession.sdkSessionId);

        // Start JSONL watcher for this SDK session
        const projectPath = projectManager.getProjectPath(session.projectId);
        jsonlWatcher.watchSession(updatedSession.sdkSessionId, projectPath);
      }
    }
  }

  resize(_chatId: string, _cols: number, _rows: number): void {
    // No-op for message-based adapter
  }

  resolvePermission(chatId: string, requestId: string, granted: boolean): void {
    sdkSessionManager.resolvePermission(chatId, requestId, granted);
  }

  resolveQuestion(chatId: string, requestId: string, answers: Record<number, string[]>): void {
    sdkSessionManager.resolveQuestion(chatId, requestId, answers);
  }

  interrupt(chatId: string): void {
    sdkSessionManager.interrupt(chatId);
  }

  getSessionState(chatId: string): SessionStateContext | null {
    const session = sdkSessionManager.getSession(chatId);
    if (!session) return null;
    // Prefer JSONL-derived state when available (richer data)
    if (session.sdkSessionId) {
      const jsonlState = jsonlWatcher.getState(session.sdkSessionId);
      if (jsonlState) return jsonlState;
    }
    return { status: session.status === 'streaming' || session.status === 'tool-use' ? 'working' : session.status === 'waiting-permission' ? 'permission-awaiting' : session.status as any };
  }

  getProjectSessionStates(projectId: string): Record<string, SessionStateContext> {
    const states = sdkSessionManager.getProjectSessionStates(projectId);
    // Overlay JSONL-derived states for richer data
    const sdkSessionIds = sdkSessionManager.getProjectSDKSessionIds(projectId);
    for (const [chatId, sdkSessionId] of Object.entries(sdkSessionIds)) {
      const state = jsonlWatcher.getState(sdkSessionId);
      if (state) states[chatId] = state;
    }
    return states;
  }

  getMessageHistory(chatId: string): SDKChatMessage[] {
    return sdkSessionManager.getMessageHistory(chatId);
  }
}
