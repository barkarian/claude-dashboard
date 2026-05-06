// === Browser (Playwright) Socket Event Payloads ===

import type { BrowserViewportMode } from './models.ts';

/** Server → clients: a new screencast frame for a chat's browser tab. */
export interface BrowserFramePayload {
  chatId: string;
  /** Base64-encoded JPEG, no data: prefix. */
  frame: string;
  /** Native pixel dimensions of the captured viewport. */
  width: number;
  height: number;
  /** Server-side timestamp (ms epoch) when the frame was emitted. */
  ts: number;
  /** Current viewport mode of the tab when the frame was captured. */
  viewportMode: BrowserViewportMode;
}

/** Server → clients: pause/resume + lock state for a chat's browser. */
export interface BrowserStatePayload {
  chatId: string;
  paused: boolean;
  /** Socket id holding the input lock; null = no client has control. */
  lockedBy: string | null;
}

/** Client → server: pause / resume the workspace's browser. */
export interface BrowserPauseRequestPayload {
  chatId: string;
}

/** Client → server: take or release the input lock for this chat. */
export interface BrowserLockRequestPayload {
  chatId: string;
  acquire: boolean;
}

/** Client → server: forwarded user input while holding the lock. */
export interface BrowserInputPayload {
  chatId: string;
  /** Coordinates are in the captured frame's pixel space (native). */
  kind: 'mouse-move' | 'mouse-down' | 'mouse-up' | 'mouse-click' | 'mouse-wheel' | 'key-down' | 'key-up' | 'type';
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  deltaX?: number;
  deltaY?: number;
  /** For key-down / key-up: a Playwright key string (e.g. "Enter", "a"). */
  key?: string;
  /** For type: the literal text to type. */
  text?: string;
}

/** Client → server: switch viewport mode for the chat's tab. */
export interface BrowserViewportRequestPayload {
  chatId: string;
  mode: BrowserViewportMode;
}

// === Terminal Socket Event Payloads ===

export interface TerminalStartPayload {
  projectId: string;
  scriptId: string;
}

export interface TerminalStopPayload {
  projectId: string;
  scriptId: string;
}

export interface TerminalInputPayload {
  projectId: string;
  scriptId: string;
  data: string;
}

export interface TerminalResizePayload {
  projectId: string;
  scriptId: string;
  cols: number;
  rows: number;
}

export interface TerminalAttachPayload {
  projectId: string;
  scriptId: string;
}

export interface TerminalDetachPayload {
  projectId: string;
  scriptId: string;
}

export interface TerminalOutputPayload {
  projectId: string;
  scriptId: string;
  data: string;
}

export interface TerminalExitPayload {
  projectId: string;
  scriptId: string;
  exitCode: number;
}

export interface TerminalStatusPayload {
  projectId: string;
  scriptId: string;
  status: string;
  exitCode?: number;
}

export interface TerminalErrorPayload {
  projectId: string;
  scriptId: string;
  error: string;
}

export interface TerminalSpawnShellPayload {
  projectId: string;
}

export interface TerminalShellSpawnedPayload {
  projectId: string;
  scriptId: string;
}

// === Claude Code Socket Event Payloads ===

export interface CCStartPayload {
  projectId: string;
  chatId: string;
  conversationId?: string; // for resume
  cols?: number;
  rows?: number;
}

export interface CCInputPayload {
  chatId: string;
  data: string;
}

export interface CCResizePayload {
  chatId: string;
  cols: number;
  rows: number;
}

export interface CCStopPayload {
  chatId: string;
}

export interface CCAttachPayload {
  chatId: string;
  cols?: number;
  rows?: number;
}

export interface CCDetachPayload {
  chatId: string;
}

export interface CCOutputPayload {
  chatId: string;
  data: string;
}

export interface CCExitPayload {
  chatId: string;
  exitCode: number;
}

export interface CCStatusPayload {
  chatId: string;
  status: 'running' | 'exited' | 'error';
}

// === File Socket Event Payloads ===

export interface FilesListPayload {
  projectId: string;
  files?: string[];
}

export interface FilesWatchPayload {
  projectId: string;
}

export interface FilesContentPayload {
  projectId: string;
  filePath: string;
  content?: string;
}

export interface FilesChangedPayload {
  projectId: string;
  event: 'add' | 'change' | 'unlink';
  path: string;
}

// === Global Active Chats (sidebar badges + dock badge) ===

import type { UnifiedStatus } from './session.ts';

export interface ActiveChat {
  chatId: string;
  label: string;
  /** UnifiedStatus for live sessions, or 'unread' for unseen replies. */
  status: UnifiedStatus | 'unread';
  projectId: string;
  /** Category emoji + id for inline marker rendering. Null = uncategorised. */
  categoryId: string | null;
  categoryEmoji: string | null;
  /** ISO timestamp of the chat's last activity — primary sort key (newest first). */
  lastActivityAt: string;
}

export interface ActiveProjectChats {
  projectName: string;
  chats: ActiveChat[];
  count: number;
}

export interface GlobalActiveChats {
  byProject: Record<string, ActiveProjectChats>;
  totalCount: number;
  /** Count of unread + awaiting chats only (excludes plain working) — used for dock/app badge */
  badgeCount: number;
}

// === Sidebar live-sync events ===
// Broadcast on the existing global:active-chats room. Used to keep every
// connected client (mobile, desktop, second laptop) in lockstep on the
// sidebar's view of projects + chats without polling. See server/services/
// sidebarSync.ts for the emit helpers.

import type { Chat, ProjectSummary } from './models.ts';

export interface SidebarChatCreated {
  projectId: string;
  chat: Chat;
}

export interface SidebarChatDeleted {
  projectId: string;
  chatId: string;
}

/** Fields that may change for a chat outside of session-status updates.
 *  Any field omitted means "no change". `categoryEmoji` is sent alongside
 *  `categoryId` so clients don't have to look up the emoji themselves.
 *  `tabOpenedAt` / `tabPinnedAt` express the chat's sidebar-tab state —
 *  null means "not in the sidebar / not pinned" respectively. */
export interface SidebarChatMetaChanged {
  projectId: string;
  chatId: string;
  label?: string;
  categoryId?: string | null;
  categoryEmoji?: string | null;
  lastActivityAt?: string;
  tabOpenedAt?: string | null;
  tabPinnedAt?: string | null;
}

export interface SidebarProjectPinChanged {
  projectId: string;
  pinned: boolean;
  pinnedAt: string | null;
}

export interface SidebarProjectReordered {
  /** Pinned-project ids in their new order, top-first. */
  orderedIds: string[];
}

export interface SidebarProjectActivity {
  projectId: string;
  lastActivityAt: string;
}

export interface SidebarProjectCreated {
  project: ProjectSummary;
}

export interface SidebarProjectDeleted {
  projectId: string;
}
