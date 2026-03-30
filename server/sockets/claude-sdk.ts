import sdkSessionManager from '../services/sdkSessionManager.ts';
import projectManager from '../services/projectManager.ts';
import { emitSidecarEvent } from '../services/sidecarEmitter.ts';
import { sendPushEvent } from '../services/tunnelClient.ts';
import jsonlWatcher, { readSessionHistory } from '../services/jsonlWatcher.ts';
import { getProjectCCSessions, getProjectCCSessionStates } from './claude-code.ts';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { SessionStateContext } from '../../shared/types/session.ts';
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

      // Pass persisted session ID if available (for resume) — prefer unified sessionId
      const savedSdkSessionId = chat?.sessionId || chat?.sdkSessionId || undefined;
      sdkSessionManager.initSession(chatId, projectId, projectPath, io, savedSdkSessionId);
      socket.emit('sdk:status', { chatId, status: 'idle' });

      // Load history from JSONL session file (single source of truth for both CC and SDK)
      if (savedSdkSessionId) {
        const messages = readSessionHistory(savedSdkSessionId, projectPath);
        if (messages.length > 0) {
          socket.emit('sdk:history', { chatId, messages });
        }
      }
    } catch (err: any) {
      console.error('sdk:start error:', err);
      socket.emit('sdk:error', { chatId, error: err.message });
    }
  });

  socket.on('sdk:send', async ({ chatId, prompt }: SDKSendPayload) => {
    try {
      const session = sdkSessionManager.getSession(chatId);
      if (session) {
        // Auto-title: rename "New Chat" after first user message
        const chat = projectManager.getChat(chatId);
        if (chat && chat.label === 'New Chat') {
          // Check if this is the first prompt by looking at the runtime message buffer
          const runtimeMessages = sdkSessionManager.getMessageHistory(chatId);
          const userMsgCount = runtimeMessages.filter(m => m.role === 'user').length;
          if (userMsgCount === 0) {
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

      // Post-completion: persist session ID, notify, push
      if (session) {
        const messages = sdkSessionManager.getMessageHistory(chatId);
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');

        // Notify desktop shell of chat reply
        const chat = projectManager.getChat(chatId);
        emitSidecarEvent({
          type: 'notification',
          title: 'Chat Reply',
          body: `Response received in "${chat?.label || 'Chat'}"`,
          deepLink: `/projects/${session.projectId}/chat/${chatId}`,
          event: 'chat-reply',
        });

        // Persist the SDK session ID for future resume
        const updatedSession = sdkSessionManager.getSession(chatId);
        const currentChat = projectManager.getChat(chatId);
        if (updatedSession?.sdkSessionId && currentChat?.sdkSessionId !== updatedSession.sdkSessionId) {
          projectManager.updateChat(chatId, { sdkSessionId: updatedSession.sdkSessionId, sessionId: updatedSession.sdkSessionId });
          console.log(`[sdk:${chatId}] Persisted SDK session ID: ${updatedSession.sdkSessionId}`);

          // Start JSONL watcher for this SDK session (supplementary to SDK events)
          const projectPath = projectManager.getProjectPath(session.projectId);
          jsonlWatcher.watchSession(updatedSession.sdkSessionId, projectPath);
        }

        // Send push notification to mobile devices (status-aware)
        const sdkJsonlState = updatedSession?.sdkSessionId
          ? jsonlWatcher.getState(updatedSession.sdkSessionId)
          : null;
        if (sdkJsonlState?.status === 'question-awaiting' && sdkJsonlState.questions?.[0]) {
          sendPushEvent('chat-question', { preview: `Claude asks: ${sdkJsonlState.questions[0].question.slice(0, 80)}`, chatId });
        } else if (sdkJsonlState?.status === 'plan-awaiting') {
          sendPushEvent('chat-plan', { preview: 'Plan ready for review', chatId });
        } else {
          const lastMsg = lastAssistant?.content;
          const preview = Array.isArray(lastMsg)
            ? (lastMsg.find((c: any) => c.type === 'text') as any)?.text?.slice(0, 100) || 'Response ready'
            : 'Response ready';
          sendPushEvent('chat-reply', { preview, chatId });
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
        // Runtime buffer empty — load from JSONL session file
        try {
          const chat = projectManager.getChat(chatId);
          const sessionId = chat?.sessionId || chat?.sdkSessionId;
          if (sessionId) {
            const projectPath = projectManager.getProjectPath(session.projectId);
            const jsonlMessages = readSessionHistory(sessionId, projectPath);
            if (jsonlMessages.length > 0) {
              socket.emit('sdk:history', { chatId, messages: jsonlMessages });
            }
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
    // Also send unified session states
    const sessionStates: Record<string, SessionStateContext> = {
      ...getProjectCCSessionStates(projectId),
    };
    callback?.(statuses, sessionStates);
  });

  socket.on('project:leave', ({ projectId }: { projectId: string }) => {
    socket.leave(`project:${projectId}`);
  });
}
