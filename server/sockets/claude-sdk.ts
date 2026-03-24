import sdkSessionManager from '../services/sdkSessionManager.ts';
import { migrateHistoryMessage } from '../services/sdkSessionManager.ts';
import projectManager from '../services/projectManager.ts';
import { emitSidecarEvent } from '../services/sidecarEmitter.ts';
import { sendPushEvent } from '../services/tunnelClient.ts';
import { getProjectCCSessions } from './claude-code.ts';
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

      const chat = projectManager.getChat(chatId);

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
        projectManager.addMessage(chatId, {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          timestamp: new Date().toISOString(),
        });

        // Auto-title: rename "New Chat" after first user message
        const chat = projectManager.getChat(chatId);
        if (chat && chat.label === 'New Chat') {
          const userMessages = chat.history.filter((m: any) => m.role === 'user');
          if (userMessages.length === 1) {
            const newLabel = prompt.trim().slice(0, 50) + (prompt.trim().length > 50 ? '...' : '');
            projectManager.updateChat(chatId, { label: newLabel });
            io.to(`claude:${chatId}`).emit('claude:chat-renamed', { chatId, label: newLabel });
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
        const messages = sdkSessionManager.getMessageHistory(chatId);
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistant) {
          projectManager.addMessage(chatId, {
            role: 'assistant',
            content: lastAssistant.content,
            timestamp: lastAssistant.timestamp || new Date().toISOString(),
          });
        }

        // Notify desktop shell of chat reply
        const chat = projectManager.getChat(chatId);
        emitSidecarEvent({
          type: 'notification',
          title: 'Chat Reply',
          body: `Response received in "${chat?.label || 'Chat'}"`,
          deepLink: `/projects/${session.projectId}/chat/${chatId}`,
          event: 'chat-reply',
        });

        // Send push notification to mobile devices
        const lastMsg = lastAssistant?.content;
        const preview = Array.isArray(lastMsg)
          ? (lastMsg.find((c: any) => c.type === 'text') as any)?.text?.slice(0, 100) || 'Response ready'
          : 'Response ready';
        sendPushEvent('chat-reply', { preview, chatId });

        // Persist the SDK session ID for future resume
        const updatedSession = sdkSessionManager.getSession(chatId);
        const currentChat = projectManager.getChat(chatId);
        if (updatedSession?.sdkSessionId && currentChat?.sdkSessionId !== updatedSession.sdkSessionId) {
          projectManager.updateChat(chatId, { sdkSessionId: updatedSession.sdkSessionId });
          console.log(`[sdk:${chatId}] Persisted SDK session ID: ${updatedSession.sdkSessionId}`);
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

  socket.on('sdk:attach', async ({ chatId }: SDKAttachPayload) => {
    const room = `claude:${chatId}`;
    socket.join(room);

    const session = sdkSessionManager.getSession(chatId);
    if (session) {
      socket.emit('sdk:status', { chatId, status: session.status });

      const messages = sdkSessionManager.getMessageHistory(chatId);
      if (messages.length > 0) {
        socket.emit('sdk:history', { chatId, messages });
      } else {
        // Runtime buffer empty — load persisted history from database
        try {
          const chat = projectManager.getChat(chatId);
          if (chat?.history && chat.history.length > 0) {
            const persistedMessages: SDKChatMessage[] = chat.history.map(migrateHistoryMessage);
            socket.emit('sdk:history', { chatId, messages: persistedMessages });
          }
        } catch (err: any) {
          console.error('sdk:attach history load error:', err);
        }
      }
    }
  });

  socket.on('sdk:check-session', ({ chatId }: SDKCheckSessionPayload, callback: Function) => {
    const session = sdkSessionManager.getSession(chatId);
    callback(session ? { exists: true, status: session.status } : { exists: false });
  });

  socket.on('project:join', ({ projectId }: { projectId: string }, callback?: Function) => {
    socket.join(`project:${projectId}`);
    // Merge SDK and CC session statuses so the chat list shows all active sessions
    const statuses = {
      ...sdkSessionManager.getProjectSessions(projectId),
      ...getProjectCCSessions(projectId),
    };
    callback?.(statuses);
  });

  socket.on('project:leave', ({ projectId }: { projectId: string }) => {
    socket.leave(`project:${projectId}`);
  });
}
