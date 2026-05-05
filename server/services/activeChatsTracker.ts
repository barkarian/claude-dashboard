/**
 * ActiveChatsTracker — aggregates "actionable" chats across all projects.
 *
 * Actionable = working | awaiting-* | unread.
 * Once a chat is read (and not currently working/awaiting) it falls out.
 * Broadcasts `global:active-chats` via Socket.IO whenever the set changes.
 */

import type { Server as SocketIOServer } from 'socket.io';
import db from './database.ts';
import projectManager from './projectManager.ts';
import sidebarSync from './sidebarSync.ts';
import type { UnifiedStatus, SessionStateContext } from '../../shared/types/session.ts';
import type { ActiveChat, GlobalActiveChats, ActiveProjectChats } from '../../shared/types/socket-events.ts';

// Auto-promote a chat to an open sidebar tab and broadcast the change.
// Called whenever a chat enters an "interesting" state (working, awaiting,
// unread) so closed tabs reappear when the agent has something to say.
// No-op if the tab was already open. Broadcasts only when state actually
// changed, to keep socket traffic clean during chatty agent runs.
function autoOpenTab(chatId: string, projectId: string): void {
  if (!projectManager.openChatTab(chatId)) return;
  const state = projectManager.getChatTabState(chatId);
  sidebarSync.chatMetaChanged({
    projectId,
    chatId,
    tabOpenedAt: state?.tabOpenedAt ?? null,
    tabPinnedAt: state?.tabPinnedAt ?? null,
  });
}

// Statuses that count as live-actionable for the sidebar / badge
const INTERESTING_STATUSES: Set<string> = new Set([
  'working',
  'question-awaiting',
  'questions-awaiting',
  'plan-awaiting',
  'permission-awaiting',
]);

interface TrackedChat {
  chatId: string;
  label: string;
  projectId: string;
  projectName: string;
  /** Live session status, or null if only tracked because of unread */
  sessionStatus: UnifiedStatus | null;
  /** True when the chat is unread (idle response not yet seen) */
  unread: boolean;
  categoryId: string | null;
  categoryEmoji: string | null;
  lastActivityAt: string;
}

// In-memory tracked chats: chatId -> TrackedChat
const tracked = new Map<string, TrackedChat>();

let io: SocketIOServer | null = null;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

// ── Public API ──────────────────────────────────────────────────────

/** Initialize the tracker — call once at server startup after io is ready. */
function init(socketIo: SocketIOServer): void {
  io = socketIo;
  loadFromDB();
}

/** Called when a CC or SDK session changes state. */
function onSessionStateChange(
  chatId: string,
  projectId: string,
  state: SessionStateContext,
): void {
  const isInteresting = INTERESTING_STATUSES.has(state.status);
  const existing = tracked.get(chatId);

  if (isInteresting) {
    if (existing) {
      existing.sessionStatus = state.status;
      const chat = projectManager.getChat(chatId);
      if (chat) {
        existing.label = chat.label;
        existing.lastActivityAt = chat.lastActivityAt;
      }
    } else {
      const info = getChatInfo(chatId, projectId);
      if (!info) return;
      tracked.set(chatId, {
        chatId,
        label: info.label,
        projectId,
        projectName: info.projectName,
        sessionStatus: state.status,
        unread: false,
        categoryId: info.categoryId,
        categoryEmoji: info.categoryEmoji,
        lastActivityAt: info.lastActivityAt,
      });
    }
    autoOpenTab(chatId, projectId);
    scheduleBroadcast();
  } else if (existing) {
    existing.sessionStatus = null;
    if (!existing.unread) tracked.delete(chatId);
    scheduleBroadcast();
  }
}

/** Called when a chat becomes unread (agent finished responding). */
function onChatUnread(chatId: string, projectId: string, label: string): void {
  const existing = tracked.get(chatId);
  if (existing) {
    existing.unread = true;
    existing.label = label;
  } else {
    const info = getChatInfo(chatId, projectId);
    tracked.set(chatId, {
      chatId,
      label: label || info?.label || 'Chat',
      projectId,
      projectName: info?.projectName || projectId,
      sessionStatus: null,
      unread: true,
      categoryId: info?.categoryId ?? null,
      categoryEmoji: info?.categoryEmoji ?? null,
      lastActivityAt: info?.lastActivityAt ?? new Date().toISOString(),
    });
  }
  autoOpenTab(chatId, projectId);
  scheduleBroadcast();
}

/** Called when a chat is marked as read by the user. Removes it from the
 * tracker unless it still has a live working/awaiting session. */
function onChatRead(chatId: string): void {
  const existing = tracked.get(chatId);
  if (!existing) return;
  existing.unread = false;
  if (!existing.sessionStatus || !INTERESTING_STATUSES.has(existing.sessionStatus)) {
    tracked.delete(chatId);
  }
  scheduleBroadcast();
}

/** Refresh category + activity for a tracked chat after an API mutation.
 * Categories are purely visual markers — they do NOT keep a chat in the
 * sidebar tracker on their own. */
function refreshChatMeta(chatId: string, projectId: string): void {
  const existing = tracked.get(chatId);
  if (!existing) {
    scheduleBroadcast();
    return;
  }
  const info = getChatInfo(chatId, projectId);
  if (!info) return;
  existing.categoryId = info.categoryId;
  existing.categoryEmoji = info.categoryEmoji;
  existing.lastActivityAt = info.lastActivityAt;
  scheduleBroadcast();
}

/** Called when a session exits (process ended). */
function onSessionExit(chatId: string): void {
  const existing = tracked.get(chatId);
  if (!existing) return;
  existing.sessionStatus = null;
  if (!existing.unread) tracked.delete(chatId);
  scheduleBroadcast();
}

/** Called when a chat is removed entirely (deleted). Unconditional drop. */
function onChatRemoved(chatId: string): void {
  if (!tracked.has(chatId)) return;
  tracked.delete(chatId);
  scheduleBroadcast();
}

/** Called when a chat label changes (auto-rename). */
function onChatRenamed(chatId: string, label: string): void {
  const existing = tracked.get(chatId);
  if (existing) {
    existing.label = label;
    scheduleBroadcast();
  }
}

/** Return current snapshot for initial load. */
function getSnapshot(): GlobalActiveChats {
  return buildSnapshot();
}

// ── Internal ────────────────────────────────────────────────────────

function getChatInfo(
  chatId: string,
  projectId: string,
): { label: string; projectName: string; categoryId: string | null; categoryEmoji: string | null; lastActivityAt: string } | null {
  const chat = projectManager.getChat(chatId);
  const project = projectManager.getProject(projectId);
  if (!chat || !project) return null;
  return {
    label: chat.label,
    projectName: project.name,
    categoryId: chat.categoryId,
    categoryEmoji: chat.category?.emoji ?? null,
    lastActivityAt: chat.lastActivityAt,
  };
}

/** Load unread chats from DB on startup. */
function loadFromDB(): void {
  const rows = db.prepare(`
    SELECT c.id, c.label, c.project_id, c.category_id,
           cat.emoji AS category_emoji,
           c.last_activity_at, c.created_at, p.name as project_name
    FROM chats c
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN chat_categories cat ON c.category_id = cat.id
    WHERE c.unread = 1
  `).all() as Array<{
    id: string; label: string; project_id: string;
    category_id: string | null; category_emoji: string | null;
    last_activity_at: string | null; created_at: string; project_name: string;
  }>;

  for (const row of rows) {
    const lastActivityAt = row.last_activity_at || row.created_at;
    tracked.set(row.id, {
      chatId: row.id,
      label: row.label,
      projectId: row.project_id,
      projectName: row.project_name,
      sessionStatus: null,
      unread: true,
      categoryId: row.category_id,
      categoryEmoji: row.category_emoji,
      lastActivityAt,
    });
  }
}

function buildSnapshot(): GlobalActiveChats {
  const byProject: Record<string, ActiveProjectChats> = {};
  let totalCount = 0;
  let badgeCount = 0;

  for (const t of tracked.values()) {
    const displayStatus: ActiveChat['status'] =
      t.sessionStatus && INTERESTING_STATUSES.has(t.sessionStatus)
        ? t.sessionStatus
        : 'unread';

    if (!byProject[t.projectId]) {
      byProject[t.projectId] = {
        projectName: t.projectName,
        chats: [],
        count: 0,
      };
    }

    byProject[t.projectId].chats.push({
      chatId: t.chatId,
      label: t.label,
      status: displayStatus,
      projectId: t.projectId,
      categoryId: t.categoryId,
      categoryEmoji: t.categoryEmoji,
      lastActivityAt: t.lastActivityAt,
    });
    byProject[t.projectId].count++;
    totalCount++;

    // Badge count: unread + awaiting (excludes plain working)
    if (
      displayStatus === 'unread' ||
      displayStatus === 'question-awaiting' ||
      displayStatus === 'questions-awaiting' ||
      displayStatus === 'plan-awaiting' ||
      displayStatus === 'permission-awaiting'
    ) {
      badgeCount++;
    }
  }

  // Activity-only sort: newest message first.
  for (const projectChats of Object.values(byProject)) {
    projectChats.chats.sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
    );
  }

  return { byProject, totalCount, badgeCount };
}

function scheduleBroadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast();
  }, 200);
}

function broadcast(): void {
  if (!io) return;
  const snapshot = buildSnapshot();
  io.to('global:active-chats').emit('global:active-chats', snapshot);
}

/** Return the Socket.IO server instance (for emitting events from routes). */
function getIO(): SocketIOServer | null {
  return io;
}

export default {
  init,
  onSessionStateChange,
  onChatUnread,
  onChatRead,
  onSessionExit,
  onChatRemoved,
  onChatRenamed,
  refreshChatMeta,
  getSnapshot,
  getIO,
};
