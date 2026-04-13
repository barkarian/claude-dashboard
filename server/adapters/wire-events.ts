/**
 * Wire adapter events to shared services.
 *
 * Subscribes to all registered adapters' standardized events and routes them
 * to activeChatsTracker, push notifications, AI titling, and unread marking.
 *
 * This centralizes the cross-cutting logic that was previously duplicated
 * in claude-code.ts and claude-sdk.ts.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { adapterRegistry } from './registry.ts';
import activeChatsTracker from '../services/activeChatsTracker.ts';
import projectManager from '../services/projectManager.ts';
import { generateChatTitleAndDescription } from '../services/aiTitleGenerator.ts';
import { sendPushEvent } from '../services/tunnelClient.ts';
import { emitSidecarEvent } from '../services/sidecarEmitter.ts';
import type { SessionStateContext } from '../../shared/types/session.ts';

const aiTitledChats = new Set<string>();
const UNREAD_CONFIRM_MS = 2500;
const idleUnreadTimers = new Map<string, ReturnType<typeof setTimeout>>();

function handlePushNotification(
  chatId: string,
  state: SessionStateContext,
  adapter: { formatPush?: (chatId: string, state: SessionStateContext, prevState: SessionStateContext) => { event: string; data: Record<string, unknown> } | null },
  prevState: SessionStateContext,
): void {
  // Let adapter customize push notifications if it implements formatPush
  if (adapter.formatPush) {
    const push = adapter.formatPush(chatId, state, prevState);
    if (push) {
      sendPushEvent(push.event, push.data);
    }
    return; // adapter handled it (or suppressed it)
  }

  // Default push notification logic
  if (state.status === 'question-awaiting' && state.questions?.[0]) {
    sendPushEvent('chat-question', { preview: `Claude asks: ${state.questions[0].question.slice(0, 80)}`, chatId });
  } else if (state.status === 'questions-awaiting' && state.questions) {
    sendPushEvent('chat-question', { preview: `Claude has ${state.questions.length} questions`, chatId });
  } else if (state.status === 'plan-awaiting') {
    sendPushEvent('chat-plan', { preview: 'Plan ready for review', chatId });
  } else if (state.status === 'permission-awaiting' && state.pendingTool) {
    sendPushEvent('chat-permission', { preview: `Approve: ${state.pendingTool.toolName}`, chatId });
  }
}

function handleUnreadTransition(
  chatId: string,
  projectId: string,
  state: SessionStateContext,
  prevState: SessionStateContext,
  io: SocketIOServer,
): void {
  // Cancel pending unread timer when status returns to an active state
  if (state.status !== 'idle') {
    const pendingTimer = idleUnreadTimers.get(chatId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      idleUnreadTimers.delete(chatId);
    }
  }

  // Defer unread marking on idle transition (prevents flash between turns)
  if (state.status === 'idle' && (prevState.status === 'working' || prevState.status === 'starting')) {
    const existingTimer = idleUnreadTimers.get(chatId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      idleUnreadTimers.delete(chatId);

      const preview = state.lastTextPreview || 'Response ready';
      sendPushEvent('chat-reply', { preview, chatId });

      projectManager.markChatUnread(chatId);
      io.to(`project:${projectId}`).emit('chat:unread', { chatId });
      const unreadChat = projectManager.getChat(chatId);
      activeChatsTracker.onChatUnread(chatId, projectId, unreadChat?.label || 'Chat');

      // Desktop shell notification
      emitSidecarEvent({
        type: 'notification',
        title: 'Chat Reply',
        body: `Response received in "${unreadChat?.label || 'Chat'}"`,
        deepLink: `/projects/${projectId}/chat/${chatId}`,
        event: 'chat-reply',
      });
    }, UNREAD_CONFIRM_MS);

    idleUnreadTimers.set(chatId, timer);
  }
}

export function wireAdapterEvents(io: SocketIOServer): void {
  for (const [, adapter] of adapterRegistry.entries()) {

    // ── State changes → activeChatsTracker + push + unread ──
    // Adapters emit: (chatId, projectId, newState, prevState)
    adapter.on('state-change', (chatId: string, projectId: string, state: SessionStateContext, prevState: SessionStateContext) => {
      // Emit unified state to project room (consumed by frontend useSessionStates)
      io.to(`project:${projectId}`).emit('claude:session-state', { chatId, state });

      // Update global active chats tracker
      activeChatsTracker.onSessionStateChange(chatId, projectId, state);

      // Push notifications
      handlePushNotification(chatId, state, adapter, prevState);

      // Deferred unread marking
      handleUnreadTransition(chatId, projectId, state, prevState, io);
    });

    // ── Session exit ──
    // Adapters emit: (chatId, projectId, exitCode)
    adapter.on('exit', (chatId: string, projectId: string, _exitCode: number) => {
      // Clean up deferred unread timer
      const pendingUnread = idleUnreadTimers.get(chatId);
      if (pendingUnread) {
        clearTimeout(pendingUnread);
        idleUnreadTimers.delete(chatId);
      }

      io.to(`project:${projectId}`).emit('claude:session-state', {
        chatId,
        state: { status: 'exited' } as SessionStateContext,
      });
      activeChatsTracker.onSessionExit(chatId);
    });

    // ── Terminal output → forward to chat room ──
    adapter.on('output', (chatId: string, data: string) => {
      io.to(`cc:${chatId}`).emit('cc:output', { chatId, data });
    });

    // ── Message (SDK-style) → forward to chat room ──
    adapter.on('message', (chatId: string, message: unknown) => {
      io.to(`claude:${chatId}`).emit('sdk:message', { chatId, message });
    });

    // ── Error ──
    adapter.on('error', (chatId: string, error: string) => {
      io.to(`cc:${chatId}`).emit('chat:error', { chatId, error });
      io.to(`claude:${chatId}`).emit('sdk:error', { chatId, error });
    });

    // ── Title hint → auto-rename + AI title generation ──
    // Adapters emit: (chatId, projectId, promptText)
    adapter.on('title-hint', (chatId: string, projectId: string, promptText: string) => {
      const chat = projectManager.getChat(chatId);
      if (!chat || chat.label !== 'New Chat') return;

      // Truncated fallback label
      const newLabel = promptText.slice(0, 50) + (promptText.length > 50 ? '...' : '');
      projectManager.updateChat(chatId, { label: newLabel });
      io.to(`project:${projectId}`).emit('claude:chat-renamed', { chatId, label: newLabel });
      activeChatsTracker.onChatRenamed(chatId, newLabel);

      // AI title generation (deduped)
      if (aiTitledChats.has(chatId)) return;
      const project = projectManager.getProject(projectId);
      if (project?.aiNamingEnabled !== 'on') return;
      aiTitledChats.add(chatId);

      generateChatTitleAndDescription(promptText).then((result) => {
        if (result) {
          projectManager.updateChat(chatId, { label: result.title, description: result.description || null });
          io.to(`project:${projectId}`).emit('claude:chat-renamed', { chatId, label: result.title });
          activeChatsTracker.onChatRenamed(chatId, result.title);
        }
      }).catch(() => {});
    });

    // ── Session ID persistence ──
    adapter.on('session-id', (chatId: string, sessionId: string) => {
      projectManager.updateChat(chatId, { sessionId, ccConversationId: sessionId, sdkSessionId: sessionId });
    });

    // ── Custom adapter events → forward to chat rooms ──
    adapter.on('custom-event', (chatId: string, event: string, data: unknown) => {
      io.to(`cc:${chatId}`).emit('chat:adapter-event', { chatId, event, data });
      io.to(`claude:${chatId}`).emit('chat:adapter-event', { chatId, event, data });
    });
  }
}
