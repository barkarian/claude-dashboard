import sdkSessionManager from '../services/sdkSessionManager.ts';
import projectManager from '../services/projectManager.ts';
import { adapterRegistry } from '../adapters/registry.ts';

/**
 * The legacy sdk:* socket events were originally for the Claude Agent SDK
 * adapter only. The frontend (SDKChatView) still emits them for every
 * message-based chat regardless of adapter — so when an adapter other than
 * claw-chat is active (e.g. opencode), we need to dispatch to the registered
 * adapter instead of running the Claude SDK code path.
 *
 * Returns true if the legacy claude-sdk handler should run; false if the
 * chat was already routed to its own adapter.
 */
function isLegacyClaudeSdkChat(chatId: string): boolean {
  const chat = projectManager.getChat(chatId);
  if (!chat) return true; // unknown chat — fall through to legacy error handling
  return chat.adapter === 'claw-chat' || chat.adapter === 'claude-agent-sdk';
}
import { generateChatTitleAndDescription } from '../services/aiTitleGenerator.ts';
import { emitSidecarEvent } from '../services/sidecarEmitter.ts';
import { sendPushEvent } from '../services/tunnelClient.ts';
import jsonlWatcher, { readSessionHistory } from '../services/jsonlWatcher.ts';
import { getProjectCCSessionStates } from './claude-code.ts';
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

// Global JSONL state-change listener for SDK sessions.
// Maps sdkSessionId back to chatId/projectId and emits claude:session-state.
let sdkJsonlListenerBound = false;

function bindSDKJsonlListener(io: SocketIOServer): void {
  if (sdkJsonlListenerBound) return;
  sdkJsonlListenerBound = true;

  jsonlWatcher.on('state-change', (sdkSessionId: string, newState: SessionStateContext) => {
    const match = sdkSessionManager.findChatBySDKSessionId(sdkSessionId);
    if (match) {
      io.to(`project:${match.projectId}`).emit('claude:session-state', { chatId: match.chatId, state: newState });
    }
  });
}

export default function registerSDKClaudeEvents(socket: Socket, io: SocketIOServer): void {
  bindSDKJsonlListener(io);

  socket.on('sdk:start', async ({ projectId, chatId }: SDKStartPayload) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const room = `claude:${chatId}`;
      socket.join(room);

      const chat = projectManager.getChat(chatId);

      // Adapter dispatch: opencode (and future non-Claude message adapters)
      // implement their own start() — let them handle the session lifecycle.
      // The Claude SDK code below only applies to claw-chat.
      if (chat && !isLegacyClaudeSdkChat(chatId)) {
        const adapter = adapterRegistry.get(chat.adapter);
        if (adapter) {
          await adapter.start({ chatId, projectId, projectPath, io, sessionId: chat.sessionId || chat.sdkSessionId || undefined });
        } else {
          socket.emit('sdk:error', { chatId, error: `Adapter not registered: ${chat.adapter}` });
        }
        return;
      }

      // Pass persisted session ID if available (for resume) — prefer unified sessionId
      const savedSdkSessionId = chat?.sessionId || chat?.sdkSessionId || undefined;
      // Enable the display_artifact MCP tool when this chat is using the claw-chat
      // adapter. The legacy sdk:* socket handlers don't go through the adapter
      // orchestrator, so without this branch the tool would never load.
      const withArtifacts = chat?.adapter === 'claw-chat';
      const model = chat?.model ?? null;
      sdkSessionManager.initSession(chatId, projectId, projectPath, io, savedSdkSessionId, { withArtifacts, model });
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
      // Non-Claude message adapters: hand off to their own sendInput().
      if (!isLegacyClaudeSdkChat(chatId)) {
        const chat = projectManager.getChat(chatId);
        if (chat) adapterRegistry.get(chat.adapter)?.sendInput(chatId, prompt);
        return;
      }

      const session = sdkSessionManager.getSession(chatId);
      if (session) {
        // Auto-title: rename "New Chat" after first user message
        const chat = projectManager.getChat(chatId);
        if (chat && chat.label === 'New Chat') {
          // Check if this is the first prompt by looking at the runtime message buffer
          const runtimeMessages = sdkSessionManager.getMessageHistory(chatId);
          const userMsgCount = runtimeMessages.filter(m => m.role === 'user').length;
          if (userMsgCount === 0) {
            // Set truncated fallback immediately
            const fallbackLabel = prompt.trim().slice(0, 50) + (prompt.trim().length > 50 ? '...' : '');
            projectManager.updateChat(chatId, { label: fallbackLabel });
            io.to(`claude:${chatId}`).emit('claude:chat-renamed', { chatId, label: fallbackLabel });

            // Fire-and-forget AI title + description generation if enabled
            const project = projectManager.getProject(session.projectId);
            if (project?.aiNamingEnabled === 'on') {
              generateChatTitleAndDescription(prompt).then((result) => {
                if (result) {
                  projectManager.updateChat(chatId, { label: result.title, description: result.description || null });
                  io.to(`claude:${chatId}`).emit('claude:chat-renamed', { chatId, label: result.title });
                  io.to(`project:${session.projectId}`).emit('claude:chat-renamed', { chatId, label: result.title });
                }
              }).catch(() => {});
            }
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
    if (!isLegacyClaudeSdkChat(chatId)) {
      const chat = projectManager.getChat(chatId);
      if (chat) adapterRegistry.get(chat.adapter)?.resolvePermission?.(chatId, requestId, granted);
      return;
    }
    sdkSessionManager.resolvePermission(chatId, requestId, granted);
  });

  socket.on('sdk:question-response', ({ chatId, requestId, answers }: SDKQuestionResponsePayload) => {
    if (!isLegacyClaudeSdkChat(chatId)) {
      const chat = projectManager.getChat(chatId);
      if (chat) adapterRegistry.get(chat.adapter)?.resolveQuestion?.(chatId, requestId, answers);
      return;
    }
    sdkSessionManager.resolveQuestion(chatId, requestId, answers);
  });

  socket.on('sdk:interrupt', ({ chatId }: SDKInterruptPayload) => {
    if (!isLegacyClaudeSdkChat(chatId)) {
      const chat = projectManager.getChat(chatId);
      if (chat) adapterRegistry.get(chat.adapter)?.interrupt?.(chatId);
      return;
    }
    sdkSessionManager.interrupt(chatId);
  });

  socket.on('sdk:end', ({ chatId }: SDKEndPayload) => {
    if (!isLegacyClaudeSdkChat(chatId)) {
      const chat = projectManager.getChat(chatId);
      if (chat) adapterRegistry.get(chat.adapter)?.stop(chatId);
      return;
    }
    sdkSessionManager.endSession(chatId);
  });

  socket.on('sdk:attach', async ({ chatId }: SDKAttachPayload) => {
    const room = `claude:${chatId}`;
    socket.join(room);

    if (!isLegacyClaudeSdkChat(chatId)) {
      const chat = projectManager.getChat(chatId);
      if (chat) adapterRegistry.get(chat.adapter)?.attach(chatId, socket);
      return;
    }

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
    if (!isLegacyClaudeSdkChat(chatId)) {
      const chat = projectManager.getChat(chatId);
      const result = chat ? adapterRegistry.get(chat.adapter)?.checkSession(chatId) : undefined;
      callback(result || { exists: false });
      return;
    }
    const session = sdkSessionManager.getSession(chatId);
    callback(session ? { exists: true, status: session.status } : { exists: false });
  });

  socket.on('project:join', ({ projectId }: { projectId: string }, callback?: Function) => {
    socket.join(`project:${projectId}`);
    // Start from the legacy Claude SDK + Claude Code states (kept for the JSONL
    // overlay below), then layer every registered adapter on top so opencode
    // and any future adapters contribute their session states too.
    const sessionStates: Record<string, SessionStateContext> = {
      ...sdkSessionManager.getProjectSessionStates(projectId),
      ...getProjectCCSessionStates(projectId),
    };
    for (const [, adapter] of adapterRegistry.entries()) {
      Object.assign(sessionStates, adapter.getProjectSessionStates(projectId));
    }
    // Overlay JSONL-derived states for SDK sessions (richer data when available)
    const sdkSessionIds = sdkSessionManager.getProjectSDKSessionIds(projectId);
    for (const [chatId, sdkSessionId] of Object.entries(sdkSessionIds)) {
      const state = jsonlWatcher.getState(sdkSessionId);
      if (state) sessionStates[chatId] = state;
    }
    callback?.(sessionStates);
  });

  socket.on('project:leave', ({ projectId }: { projectId: string }) => {
    socket.leave(`project:${projectId}`);
  });
}
