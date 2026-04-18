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
  favorite: boolean;
  sortOrder: number | null;
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
    // Upsert
    if (existing) {
      existing.sessionStatus = state.status;
      existing.fresh = false; // session started, no longer fresh
      // Refresh label + activity timestamp in case either changed.
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
        seen: false,
        fresh: false,
        favorite: info.favorite,
        sortOrder: info.sortOrder,
        lastActivityAt: info.lastActivityAt,
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
      favorite: info?.favorite ?? false,
      sortOrder: info?.sortOrder ?? null,
      lastActivityAt: info?.lastActivityAt ?? new Date().toISOString(),
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
    favorite: info?.favorite ?? false,
    sortOrder: info?.sortOrder ?? null,
    lastActivityAt: info?.lastActivityAt ?? new Date().toISOString(),
  });
  scheduleBroadcast();
}

/** Refresh favorite + sortOrder for a tracked chat after an API mutation. */
function refreshChatMeta(chatId: string, projectId: string): void {
  const existing = tracked.get(chatId);
  const info = getChatInfo(chatId, projectId);
  if (existing && info) {
    existing.favorite = info.favorite;
    existing.sortOrder = info.sortOrder;
    existing.lastActivityAt = info.lastActivityAt;
    scheduleBroadcast();
    return;
  }
  // Favorited chats should appear in the tracker even if they had no other state.
  if (info?.favorite) {
    tracked.set(chatId, {
      chatId,
      label: info.label,
      projectId,
      projectName: info.projectName,
      sessionStatus: null,
      unread: false,
      seen: false,
      fresh: false,
      favorite: true,
      sortOrder: info.sortOrder,
      lastActivityAt: info.lastActivityAt,
    });
    scheduleBroadcast();
    return;
  }
  // Not favorited and not tracked — nothing to do, but broadcast anyway in case client re-sorts.
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

function getChatInfo(chatId: string, projectId: string): { label: string; projectName: string; favorite: boolean; sortOrder: number | null; lastActivityAt: string } | null {
  const chat = projectManager.getChat(chatId);
  const project = projectManager.getProject(projectId);
  if (!chat || !project) return null;
  return { label: chat.label, projectName: project.name, favorite: chat.favorite, sortOrder: chat.sortOrder, lastActivityAt: chat.lastActivityAt };
}

/** Load unread, pinned (seen), and favorited chats from DB on startup. */
function loadFromDB(): void {
  const rows = db.prepare(`
    SELECT c.id, c.label, c.project_id, c.unread, c.pinned, c.favorite, c.sort_order, c.last_activity_at, c.created_at, p.name as project_name
    FROM chats c
    JOIN projects p ON c.project_id = p.id
    WHERE c.unread = 1 OR c.pinned = 1 OR c.favorite = 1
  `).all() as Array<{ id: string; label: string; project_id: string; unread: number; pinned: number; favorite: number; sort_order: number | null; last_activity_at: string | null; created_at: string; project_name: string }>;

  for (const row of rows) {
    const lastActivityAt = row.last_activity_at || row.created_at;
    const existing = tracked.get(row.id);
    if (existing) {
      if (row.unread) existing.unread = true;
      if (row.pinned && !row.unread) existing.seen = true;
      existing.favorite = !!row.favorite;
      existing.sortOrder = typeof row.sort_order === 'number' ? row.sort_order : null;
      existing.lastActivityAt = lastActivityAt;
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
        favorite: !!row.favorite,
        sortOrder: typeof row.sort_order === 'number' ? row.sort_order : null,
        lastActivityAt,
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
      favorite: t.favorite,
      sortOrder: t.sortOrder,
      lastActivityAt: t.lastActivityAt,
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

  // Pinned-activity sort (mirrors server SQL): effective = sort_order ?? epoch(activity).
  // Higher timestamp wins, so dragged anchors and real activity live on the same
  // date line — fresher messages naturally overtake older pinned anchors.
  for (const projectChats of Object.values(byProject)) {
    projectChats.chats.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const aEff = a.sortOrder ?? new Date(a.lastActivityAt).getTime();
      const bEff = b.sortOrder ?? new Date(b.lastActivityAt).getTime();
      return bEff - aEff;
    });
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
  refreshChatMeta,
  getSnapshot,
  getIO,
};
