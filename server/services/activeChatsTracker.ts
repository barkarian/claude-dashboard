/**
 * ActiveChatsTracker — aggregates "interesting" chats across all projects.
 *
 * Interesting = working | awaiting-* | unread | seen (read but not dismissed).
 * Broadcasts `global:active-chats` via Socket.IO whenever the set changes.
 */

import type { Server as SocketIOServer } from 'socket.io';
import db from './database.ts';
import projectManager from './projectManager.ts';
import type { UnifiedStatus, SessionStateContext } from '../../shared/types/session.ts';
import type { ActiveChat, GlobalActiveChats, ActiveProjectChats } from '../../shared/types/socket-events.ts';

// Statuses that count as "interesting" for the sidebar / badge
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
  /** Live session status, or null if only tracked because of unread/seen */
  sessionStatus: UnifiedStatus | null;
  /** True when the chat is unread (idle response not yet seen) */
  unread: boolean;
  /** True when the chat was read but not yet dismissed by the user */
  seen: boolean;
  /** True when the chat was just created and has no messages yet */
  fresh: boolean;
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
    // Upsert
    if (existing) {
      existing.sessionStatus = state.status;
      existing.fresh = false; // session started, no longer fresh
      // Refresh label in case it was auto-renamed
      const chat = projectManager.getChat(chatId);
      if (chat) existing.label = chat.label;
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
        seen: false,
        fresh: false,
      });
    }
    scheduleBroadcast();
  } else if (existing) {
    // Status is no longer interesting (e.g. idle, exited)
    existing.sessionStatus = null;
    if (!existing.unread && !existing.seen && !existing.fresh) {
      // Nothing interesting left — remove
      tracked.delete(chatId);
    }
    scheduleBroadcast();
  }
}

/** Called when a chat becomes unread (agent finished responding). */
function onChatUnread(chatId: string, projectId: string, label: string): void {
  const existing = tracked.get(chatId);
  if (existing) {
    existing.unread = true;
    existing.seen = false; // back to unread overrides seen
    existing.fresh = false;
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
      seen: false,
      fresh: false,
    });
  }
  scheduleBroadcast();
}

/** Called when a new chat is created (no messages yet). */
function onChatCreated(chatId: string, projectId: string, label: string): void {
  if (tracked.has(chatId)) return; // already tracked
  const info = getChatInfo(chatId, projectId);
  tracked.set(chatId, {
    chatId,
    label: label || info?.label || 'New Chat',
    projectId,
    projectName: info?.projectName || projectId,
    sessionStatus: null,
    unread: false,
    seen: false,
    fresh: true,
  });
  scheduleBroadcast();
}

/** Called when a chat is marked as read by the user — transitions to 'seen'. */
function onChatRead(chatId: string): void {
  const existing = tracked.get(chatId);
  if (!existing) return;
  if (!existing.unread) return; // already read, nothing to do
  existing.unread = false;
  existing.seen = true; // keep in tracker as 'seen'
  scheduleBroadcast();
}

/** Called when the user explicitly dismisses a chat from the tracker. */
function onChatDismiss(chatId: string): void {
  const existing = tracked.get(chatId);
  if (!existing) return;
  existing.seen = false;
  existing.unread = false;
  existing.fresh = false;
  if (!existing.sessionStatus || !INTERESTING_STATUSES.has(existing.sessionStatus)) {
    tracked.delete(chatId);
  }
  scheduleBroadcast();
}

/** Called when a session exits (process ended). */
function onSessionExit(chatId: string): void {
  const existing = tracked.get(chatId);
  if (!existing) return;
  existing.sessionStatus = null;
  if (!existing.unread && !existing.seen && !existing.fresh) {
    tracked.delete(chatId);
  }
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

function getChatInfo(chatId: string, projectId: string): { label: string; projectName: string } | null {
  const chat = projectManager.getChat(chatId);
  const project = projectManager.getProject(projectId);
  if (!chat || !project) return null;
  return { label: chat.label, projectName: project.name };
}

/** Load both unread and pinned (seen) chats from DB on startup. */
function loadFromDB(): void {
  const rows = db.prepare(`
    SELECT c.id, c.label, c.project_id, c.unread, c.pinned, p.name as project_name
    FROM chats c
    JOIN projects p ON c.project_id = p.id
    WHERE c.unread = 1 OR c.pinned = 1
  `).all() as Array<{ id: string; label: string; project_id: string; unread: number; pinned: number; project_name: string }>;

  for (const row of rows) {
    const existing = tracked.get(row.id);
    if (existing) {
      if (row.unread) existing.unread = true;
      if (row.pinned && !row.unread) existing.seen = true;
    } else {
      tracked.set(row.id, {
        chatId: row.id,
        label: row.label,
        projectId: row.project_id,
        projectName: row.project_name,
        sessionStatus: null,
        unread: !!row.unread,
        seen: !!row.pinned && !row.unread,
        fresh: false,
      });
    }
  }
}

function buildSnapshot(): GlobalActiveChats {
  const byProject: Record<string, ActiveProjectChats> = {};
  let totalCount = 0;
  let badgeCount = 0;

  for (const t of tracked.values()) {
    // Determine the display status
    let displayStatus: ActiveChat['status'];
    if (t.sessionStatus && INTERESTING_STATUSES.has(t.sessionStatus)) {
      displayStatus = t.sessionStatus;
    } else if (t.unread) {
      displayStatus = 'unread';
    } else if (t.fresh) {
      displayStatus = 'new';
    } else {
      displayStatus = 'seen';
    }

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
    });
    byProject[t.projectId].count++;
    totalCount++;

    // Badge count: only unread + awaiting (not working, not seen, not new)
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
  onChatCreated,
  onChatUnread,
  onChatRead,
  onChatDismiss,
  onSessionExit,
  onChatRenamed,
  getSnapshot,
  getIO,
};
