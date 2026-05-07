/**
 * sidebarSync — broadcast helpers that keep every connected client's sidebar
 * in lockstep with the database. Piggybacks on the existing single global
 * room (`global:active-chats`) that all sockets auto-join on connect, so
 * every mobile + desktop client gets the updates without per-user scoping.
 *
 * Emit from route handlers (or projectManager hot paths) right after the DB
 * write — never before, otherwise a transient failure could broadcast a
 * state that doesn't actually exist on disk.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type {
  SidebarChatCreated,
  SidebarChatDeleted,
  SidebarChatMetaChanged,
  SidebarChatTabsReordered,
  SidebarProjectPinChanged,
  SidebarProjectReordered,
  SidebarProjectActivity,
  SidebarProjectCreated,
  SidebarProjectDeleted,
} from '../../shared/types/socket-events.ts';

const ROOM = 'global:active-chats';

// Hold our own io reference (set at server startup) instead of going through
// activeChatsTracker — projectManager calls sidebarSync.projectActivity from
// the addMessage hot path, and importing activeChatsTracker here would
// re-import projectManager, creating a circular module graph.
let io: SocketIOServer | null = null;

function init(socketIo: SocketIOServer): void {
  io = socketIo;
}

function emit(event: string, payload: unknown): void {
  if (!io) return;
  io.to(ROOM).emit(event, payload);
}

// ── Chats ───────────────────────────────────────────────────────────
function chatCreated(payload: SidebarChatCreated): void {
  emit('sidebar:chat-created', payload);
}

function chatDeleted(payload: SidebarChatDeleted): void {
  emit('sidebar:chat-deleted', payload);
}

function chatMetaChanged(payload: SidebarChatMetaChanged): void {
  emit('sidebar:chat-meta-changed', payload);
}

function chatTabsReordered(payload: SidebarChatTabsReordered): void {
  emit('sidebar:chat-tabs-reordered', payload);
}

// ── Projects ────────────────────────────────────────────────────────
function projectPinChanged(payload: SidebarProjectPinChanged): void {
  emit('sidebar:project-pin-changed', payload);
}

function projectReordered(payload: SidebarProjectReordered): void {
  emit('sidebar:project-reordered', payload);
}

function projectCreated(payload: SidebarProjectCreated): void {
  emit('sidebar:project-created', payload);
}

function projectDeleted(payload: SidebarProjectDeleted): void {
  emit('sidebar:project-deleted', payload);
}

// ── Activity (debounced) ────────────────────────────────────────────
// Agent runs append messages every few hundred ms; emitting once per write
// would saturate the socket and force the sidebar to re-sort constantly.
// Coalesce per project on a 2s timer — the user's eye doesn't notice
// activity-order shuffles faster than that anyway.
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingActivity = new Map<string, string>(); // projectId -> latest lastActivityAt

function projectActivity(payload: SidebarProjectActivity): void {
  pendingActivity.set(payload.projectId, payload.lastActivityAt);
  if (activityTimers.has(payload.projectId)) return;
  const t = setTimeout(() => {
    activityTimers.delete(payload.projectId);
    const latest = pendingActivity.get(payload.projectId);
    pendingActivity.delete(payload.projectId);
    if (latest) emit('sidebar:project-activity', { projectId: payload.projectId, lastActivityAt: latest });
  }, 2000);
  activityTimers.set(payload.projectId, t);
}

export default {
  init,
  chatCreated,
  chatDeleted,
  chatMetaChanged,
  chatTabsReordered,
  projectPinChanged,
  projectReordered,
  projectCreated,
  projectDeleted,
  projectActivity,
};
