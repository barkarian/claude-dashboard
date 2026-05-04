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
