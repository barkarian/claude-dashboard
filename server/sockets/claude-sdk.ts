import sdkSessionManager from '../services/sdkSessionManager.ts';
import { migrateHistoryMessage } from '../services/sdkSessionManager.ts';
import projectManager from '../services/projectManager.js';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type {
  SDKStartPayload,
  SDKSendPayload,
  SDKPermissionResponsePayload,
  SDKInterruptPayload,
  SDKEndPayload,
  SDKAttachPayload,
  SDKCheckSessionPayload,
  SDKQuestionResponsePayload,
  SDKChatMessage,
} from '../../shared/types/sdk.ts';

export default function registerSDKClaudeEvents(socket: Socket, io: SocketIOServer): void {
  socket.on('sdk:start', async ({ projectId, chatId }: SDKStartPayload) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const room = `claude:${chatId}`;
      socket.join(room);

      const project = await projectManager.getProject(projectId);
      const chat = (project?.chats || []).find((c: any) => c.id === chatId);

      // Pass persisted SDK session ID if available (for resume)
      const savedSdkSessionId = chat?.sdkSessionId || undefined;
      sdkSessionManager.initSession(chatId, projectId, projectPath, io, savedSdkSessionId);
      socket.emit('sdk:status', { chatId, status: 'idle' });

      // If chat has history, send it to the client
      if (chat?.history && chat.history.length > 0) {
        const messages: SDKChatMessage[] = chat.history.map(migrateHistoryMessage);
        socket.emit('sdk:history', { chatId, messages });
      }
    } catch (err: any) {
      console.error('sdk:start error:', err);
      socket.emit('sdk:error', { chatId, error: err.message });
    }
  });

  socket.on('sdk:send', async ({ chatId, prompt }: SDKSendPayload) => {
    try {
      // Save user message to chat history
      const session = sdkSessionManager.getSession(chatId);
      if (session) {
        const project = await projectManager.getProject(session.projectId);
        if (project) {
          const chat = (project.chats || []).find((c: any) => c.id === chatId);
          if (chat) {
            chat.history.push({
              role: 'user',
              content: [{ type: 'text', text: prompt }],
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

      const result = await sdkSessionManager.sendPrompt(chatId, prompt);
      if (result.error) {
        socket.emit('sdk:error', { chatId, error: result.error });
        return;
      }

      // Save assistant response and SDK session ID to history after completion
      if (session) {
        const project = await projectManager.getProject(session.projectId);
        if (project) {
          const chat = (project.chats || []).find((c: any) => c.id === chatId);
          if (chat) {
            const messages = sdkSessionManager.getMessageHistory(chatId);
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
            if (lastAssistant) {
              chat.history.push({
                role: 'assistant',
                content: lastAssistant.content,
                timestamp: lastAssistant.timestamp || new Date().toISOString(),
              });
            }

            // Persist the SDK session ID for future resume
            const updatedSession = sdkSessionManager.getSession(chatId);
            if (updatedSession?.sdkSessionId && chat.sdkSessionId !== updatedSession.sdkSessionId) {
              chat.sdkSessionId = updatedSession.sdkSessionId;
              console.log(`[sdk:${chatId}] Persisted SDK session ID: ${updatedSession.sdkSessionId}`);
            }

            await projectManager.updateProject(session.projectId, { chats: project.chats });
          }
        }
      }
    } catch (err: any) {
      console.error('sdk:send error:', err);
      socket.emit('sdk:error', { chatId, error: err.message });
    }
  });

  socket.on('sdk:permission-response', ({ chatId, requestId, granted }: SDKPermissionResponsePayload) => {
    sdkSessionManager.resolvePermission(chatId, requestId, granted);
  });

  socket.on('sdk:question-response', ({ chatId, requestId, answers }: SDKQuestionResponsePayload) => {
    sdkSessionManager.resolveQuestion(chatId, requestId, answers);
  });

  socket.on('sdk:interrupt', ({ chatId }: SDKInterruptPayload) => {
    sdkSessionManager.interrupt(chatId);
  });

  socket.on('sdk:end', ({ chatId }: SDKEndPayload) => {
    sdkSessionManager.endSession(chatId);
  });

  socket.on('sdk:attach', ({ chatId }: SDKAttachPayload) => {
    const room = `claude:${chatId}`;
    socket.join(room);

    const session = sdkSessionManager.getSession(chatId);
    if (session) {
      socket.emit('sdk:status', { chatId, status: session.status });

      const messages = sdkSessionManager.getMessageHistory(chatId);
      if (messages.length > 0) {
        socket.emit('sdk:history', { chatId, messages });
      }
    }
  });

  socket.on('sdk:check-session', ({ chatId }: SDKCheckSessionPayload, callback: Function) => {
    const session = sdkSessionManager.getSession(chatId);
    callback(session ? { exists: true, status: session.status } : { exists: false });
  });

  socket.on('project:join', ({ projectId }: { projectId: string }, callback?: Function) => {
    socket.join(`project:${projectId}`);
    const statuses = sdkSessionManager.getProjectSessions(projectId);
    callback?.(statuses);
  });

  socket.on('project:leave', ({ projectId }: { projectId: string }) => {
    socket.leave(`project:${projectId}`);
  });
}
