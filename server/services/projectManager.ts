import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import db from './database.ts';
import gitService from './gitService.ts';
import type { Project, ProjectSummary, Script, Chat, ChatHistoryEntry, ChatAdapter, SavedRecording, SavedRecordingScript } from '../../shared/types/models.ts';

// === Project Methods ===

function listProjects(): ProjectSummary[] {
  const rows = db.prepare(`
    SELECT
      p.id, p.name, p.path, p.repo, p.created_at,
      (SELECT COUNT(*) FROM scripts WHERE project_id = p.id) AS scriptsCount,
      (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chatsCount
    FROM projects p
    ORDER BY p.created_at DESC
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    path: r.path,
    repo: r.repo || null,
    createdAt: r.created_at,
    scriptsCount: r.scriptsCount,
    chatsCount: r.chatsCount,
  }));
}

function listProjectsPaginated(limit: number = 20, offset: number = 0): { projects: ProjectSummary[]; total: number } {
  const { total } = db.prepare('SELECT COUNT(*) as total FROM projects').get() as any;

  const rows = db.prepare(`
    SELECT
      p.id, p.name, p.path, p.repo, p.created_at,
      (SELECT COUNT(*) FROM scripts WHERE project_id = p.id) AS scriptsCount,
      (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chatsCount
    FROM projects p
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as any[];

  const projects = rows.map(r => ({
    id: r.id,
    name: r.name,
    path: r.path,
    repo: r.repo || null,
    createdAt: r.created_at,
    scriptsCount: r.scriptsCount,
    chatsCount: r.chatsCount,
  }));

  return { projects, total };
}

function searchProjectsPaginated(search: string, limit: number = 20, offset: number = 0): { projects: ProjectSummary[]; total: number } {
  const pattern = `%${search}%`;

  const { total } = db.prepare(
    'SELECT COUNT(*) as total FROM projects WHERE name LIKE ? OR path LIKE ?'
  ).get(pattern, pattern) as any;

  const rows = db.prepare(`
    SELECT
      p.id, p.name, p.path, p.repo, p.created_at,
      (SELECT COUNT(*) FROM scripts WHERE project_id = p.id) AS scriptsCount,
      (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chatsCount
    FROM projects p
    WHERE p.name LIKE ? OR p.path LIKE ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(pattern, pattern, limit, offset) as any[];

  const projects = rows.map(r => ({
    id: r.id,
    name: r.name,
    path: r.path,
    repo: r.repo || null,
    createdAt: r.created_at,
    scriptsCount: r.scriptsCount,
    chatsCount: r.chatsCount,
  }));

  return { projects, total };
}

function parseAdapterOrder(raw: unknown): ChatAdapter[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function getProject(projectId: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) return null;

  const scripts = listScripts(projectId);
  const chats = listChatsWithHistory(projectId);

  return {
    id: row.id,
    name: row.name,
    path: row.path,
    repo: row.repo || null,
    createdAt: row.created_at,
    shellOverride: row.shell_override || null,
    defaultAdapter: (row.default_adapter as ChatAdapter) || 'claude-agent-sdk',
    adapterOrder: parseAdapterOrder(row.adapter_order),
    aiNamingEnabled: (row.ai_naming_enabled as 'none' | 'on') || 'none',
    scripts,
    chats,
  };
}

async function createProject(name: string, projectPath?: string, repoUrl?: string): Promise<{ project: Project; setupSessionId: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const defaultBase = path.join(os.homedir(), 'projects');
  const targetPath = projectPath || path.join(defaultBase, slug);

  // Generate ID: slug, or slug + uuid suffix if already taken
  let id = slug;
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (existing) {
    id = `${slug}-${uuidv4().slice(0, 8)}`;
  }

  // Create directory and initialize
  if (repoUrl) {
    await gitService.clone(repoUrl, targetPath);
  } else {
    await fs.mkdir(targetPath, { recursive: true });
    await gitService.init(targetPath);
  }

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, path, repo, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, targetPath, repoUrl || null, now);

  const project: Project = {
    id,
    name,
    path: targetPath,
    repo: repoUrl || null,
    createdAt: now,
    shellOverride: null,
    defaultAdapter: 'claude-agent-sdk',
    adapterOrder: null,
    aiNamingEnabled: 'none',
    scripts: [],
    chats: [],
  };

  return { project, setupSessionId: uuidv4() };
}

function registerProject(name: string, projectPath: string): Project {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  let id = slug;
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (existing) {
    id = `${slug}-${uuidv4().slice(0, 8)}`;
  }

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, path, repo, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, projectPath, null, now);

  return {
    id,
    name,
    path: projectPath,
    repo: null,
    createdAt: now,
    shellOverride: null,
    defaultAdapter: 'claude-agent-sdk',
    adapterOrder: null,
    aiNamingEnabled: 'none',
    scripts: [],
    chats: [],
  };
}

function updateProject(projectId: string, updates: { name?: string; path?: string; shellOverride?: string | null; defaultAdapter?: ChatAdapter; adapterOrder?: ChatAdapter[] | null; aiNamingEnabled?: 'none' | 'on' }): Project | null {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');

  if (updates.name !== undefined) {
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(updates.name, projectId);
  }
  if (updates.path !== undefined) {
    if (!fsSync.existsSync(updates.path) || !fsSync.statSync(updates.path).isDirectory()) {
      throw new Error('Path does not exist or is not a directory');
    }
    db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(updates.path, projectId);
  }
  if (updates.shellOverride !== undefined) {
    db.prepare('UPDATE projects SET shell_override = ? WHERE id = ?').run(updates.shellOverride, projectId);
  }
  if (updates.defaultAdapter !== undefined) {
    db.prepare('UPDATE projects SET default_adapter = ? WHERE id = ?').run(updates.defaultAdapter, projectId);
  }
  if (updates.adapterOrder !== undefined) {
    const serialized = updates.adapterOrder === null ? null : JSON.stringify(updates.adapterOrder);
    db.prepare('UPDATE projects SET adapter_order = ? WHERE id = ?').run(serialized, projectId);
    // Keep default_adapter in sync with index 0.
    if (Array.isArray(updates.adapterOrder) && updates.adapterOrder.length > 0) {
      db.prepare('UPDATE projects SET default_adapter = ? WHERE id = ?').run(updates.adapterOrder[0], projectId);
    }
  }
  if (updates.aiNamingEnabled !== undefined) {
    db.prepare('UPDATE projects SET ai_naming_enabled = ? WHERE id = ?').run(updates.aiNamingEnabled, projectId);
  }

  return getProject(projectId);
}

async function deleteProject(projectId: string, deleteFolder: boolean = true): Promise<void> {
  const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) throw new Error('Project not found');

  // Delete from DB first (CASCADE handles scripts/chats/messages)
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  // Remove directory only if requested
  if (deleteFolder) {
    try {
      await fs.rm(row.path, { recursive: true, force: true });
    } catch (err) {
      console.error('Error deleting project directory:', err);
    }
  }
}

function projectDirectoryExists(projectId: string): boolean {
  const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) throw new Error('Project not found');
  try {
    const stat = fsSync.statSync(row.path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function getProjectPath(projectId: string): string {
  const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) throw new Error('Project not found');
  return row.path;
}

// === Script Methods ===

function listScripts(projectId: string): Script[] {
  const rows = db.prepare('SELECT * FROM scripts WHERE project_id = ? ORDER BY created_at').all(projectId) as any[];
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    command: r.command,
    autostart: r.autostart === 1,
  }));
}

function createScript(projectId: string, label: string, command: string, autostart?: boolean): Script {
  const id = uuidv4();
  db.prepare('INSERT INTO scripts (id, project_id, label, command, autostart) VALUES (?, ?, ?, ?, ?)').run(id, projectId, label, command, autostart ? 1 : 0);
  return { id, label, command, autostart: autostart || false };
}

function updateScript(scriptId: string, updates: { label?: string; command?: string; autostart?: boolean }): Script | null {
  const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  if (!row) return null;

  if (updates.label !== undefined) db.prepare('UPDATE scripts SET label = ? WHERE id = ?').run(updates.label, scriptId);
  if (updates.command !== undefined) db.prepare('UPDATE scripts SET command = ? WHERE id = ?').run(updates.command, scriptId);
  if (updates.autostart !== undefined) db.prepare('UPDATE scripts SET autostart = ? WHERE id = ?').run(updates.autostart ? 1 : 0, scriptId);

  const updated = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  return {
    id: updated.id,
    label: updated.label,
    command: updated.command,
    autostart: updated.autostart === 1,
  };
}

function deleteScript(scriptId: string): void {
  db.prepare('DELETE FROM scripts WHERE id = ?').run(scriptId);
}

function getScript(scriptId: string): Script | null {
  const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  if (!row) return null;
  return { id: row.id, label: row.label, command: row.command, autostart: row.autostart === 1 };
}

// === Chat Methods ===

const CHAT_ORDER_CLAUSE = 'ORDER BY favorite DESC, sort_order IS NULL, sort_order ASC, last_activity_at DESC';

function listChats(projectId: string): Chat[] {
  const rows = db.prepare(`SELECT * FROM chats WHERE project_id = ? ${CHAT_ORDER_CLAUSE}`).all(projectId) as any[];
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    description: r.description || null,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at || r.created_at,
    history: [],
    sdkSessionId: r.sdk_session_id || null,
    adapter: (r.adapter as ChatAdapter) || 'claude-agent-sdk',
    ccConversationId: r.cc_conversation_id || null,
    sessionId: r.session_id || null,
    draftMessage: r.draft_message || null,
    stashedInput: r.stashed_input || null,
    unread: !!r.unread,
    favorite: !!r.favorite,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : null,
  }));
}

function listChatsPaginated(projectId: string, opts: { limit?: number; offset?: number; search?: string } = {}): { chats: Chat[]; total: number } {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  if (opts.search) {
    const pattern = `%${opts.search}%`;

    const { total } = db.prepare(
      'SELECT COUNT(*) as total FROM chats WHERE project_id = ? AND (label LIKE ? OR description LIKE ?)'
    ).get(projectId, pattern, pattern) as any;

    const rows = db.prepare(
      `SELECT * FROM chats WHERE project_id = ? AND (label LIKE ? OR description LIKE ?) ${CHAT_ORDER_CLAUSE} LIMIT ? OFFSET ?`
    ).all(projectId, pattern, pattern, limit, offset) as any[];

    return { chats: rows.map(r => mapRowToChat(r)), total };
  }

  const { total } = db.prepare(
    'SELECT COUNT(*) as total FROM chats WHERE project_id = ?'
  ).get(projectId) as any;

  const rows = db.prepare(
    `SELECT * FROM chats WHERE project_id = ? ${CHAT_ORDER_CLAUSE} LIMIT ? OFFSET ?`
  ).all(projectId, limit, offset) as any[];

  return { chats: rows.map(r => mapRowToChat(r)), total };
}

function listChatsWithHistory(projectId: string): Chat[] {
  const chatRows = db.prepare(`SELECT * FROM chats WHERE project_id = ? ${CHAT_ORDER_CLAUSE}`).all(projectId) as any[];
  return chatRows.map(r => mapRowToChat(r));
}

function mapRowToChat(r: any): Chat {
  return {
    id: r.id,
    label: r.label,
    description: r.description || null,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at || r.created_at,
    history: getChatMessages(r.id),
    sdkSessionId: r.sdk_session_id || null,
    adapter: (r.adapter as ChatAdapter) || 'claude-agent-sdk',
    ccConversationId: r.cc_conversation_id || null,
    sessionId: r.session_id || null,
    draftMessage: r.draft_message || null,
    stashedInput: r.stashed_input || null,
    unread: !!r.unread,
    favorite: !!r.favorite,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : null,
  };
}

function createChat(projectId: string, label?: string, adapter?: ChatAdapter): Chat {
  const id = uuidv4();
  const now = new Date().toISOString();
  const chatAdapter = adapter || 'claude-agent-sdk';
  db.prepare('INSERT INTO chats (id, project_id, label, adapter, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, label || 'New Chat', chatAdapter, now, now);
  return {
    id,
    label: label || 'New Chat',
    description: null,
    createdAt: now,
    lastActivityAt: now,
    history: [],
    sdkSessionId: null,
    adapter: chatAdapter,
    ccConversationId: null,
    sessionId: null,
    draftMessage: null,
    stashedInput: null,
    unread: false,
    favorite: false,
    sortOrder: null,
  };
}

function getChat(chatId: string): Chat | null {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any;
  if (!row) return null;
  return mapRowToChat(row);
}

function updateChat(chatId: string, updates: { label?: string; description?: string | null; sdkSessionId?: string | null; ccConversationId?: string | null; sessionId?: string | null; draftMessage?: string | null }): Chat | null {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any;
  if (!row) return null;

  if (updates.label !== undefined) db.prepare('UPDATE chats SET label = ? WHERE id = ?').run(updates.label, chatId);
  if (updates.description !== undefined) db.prepare('UPDATE chats SET description = ? WHERE id = ?').run(updates.description, chatId);
  if (updates.sdkSessionId !== undefined) db.prepare('UPDATE chats SET sdk_session_id = ? WHERE id = ?').run(updates.sdkSessionId, chatId);
  if (updates.ccConversationId !== undefined) db.prepare('UPDATE chats SET cc_conversation_id = ? WHERE id = ?').run(updates.ccConversationId, chatId);
  if (updates.sessionId !== undefined) db.prepare('UPDATE chats SET session_id = ? WHERE id = ?').run(updates.sessionId, chatId);
  if (updates.draftMessage !== undefined) db.prepare('UPDATE chats SET draft_message = ? WHERE id = ?').run(updates.draftMessage, chatId);

  return getChat(chatId);
}

function touchChatActivity(chatId: string): void {
  db.prepare("UPDATE chats SET last_activity_at = datetime('now') WHERE id = ?").run(chatId);
}

function updateDraft(chatId: string, text: string): void {
  db.prepare('UPDATE chats SET draft_message = ? WHERE id = ?').run(text || null, chatId);
}

function updateStashedInput(chatId: string, text: string): void {
  db.prepare('UPDATE chats SET stashed_input = ? WHERE id = ?').run(text || null, chatId);
}

function markChatUnread(chatId: string): void {
  db.prepare('UPDATE chats SET unread = 1, pinned = 1 WHERE id = ?').run(chatId);
}

function markChatRead(chatId: string): void {
  db.prepare('UPDATE chats SET unread = 0 WHERE id = ?').run(chatId);
}

function markChatDismissed(chatId: string): void {
  db.prepare('UPDATE chats SET pinned = 0 WHERE id = ?').run(chatId);
}

function setChatFavorite(chatId: string, favorite: boolean): void {
  db.prepare('UPDATE chats SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, chatId);
}

/**
 * Insert `chatId` between `prevId` and `nextId` in the project's chat order.
 * Backfills sort_order for adjacent NULL rows by seeding them from
 * last_activity_at epoch so midpoint math always has a valid baseline.
 */
function reorderChat(projectId: string, chatId: string, prevId: string | null, nextId: string | null): void {
  const seedSort = (id: string): number => {
    const row = db.prepare('SELECT sort_order, last_activity_at, created_at FROM chats WHERE id = ? AND project_id = ?').get(id, projectId) as any;
    if (!row) throw new Error(`Chat ${id} not found in project ${projectId}`);
    if (typeof row.sort_order === 'number') return row.sort_order;
    const ts = new Date(row.last_activity_at || row.created_at).getTime();
    // Negative so that newer activity (larger ts → more negative) sorts first under ASC ordering,
    // matching the legacy "ORDER BY last_activity_at DESC" behavior for un-dragged chats.
    const seeded = -ts;
    db.prepare('UPDATE chats SET sort_order = ? WHERE id = ?').run(seeded, id);
    return seeded;
  };

  let newOrder: number;
  if (prevId && nextId) {
    const prevSort = seedSort(prevId);
    const nextSort = seedSort(nextId);
    newOrder = (prevSort + nextSort) / 2;
  } else if (prevId) {
    const prevSort = seedSort(prevId);
    newOrder = prevSort + 1000;
  } else if (nextId) {
    const nextSort = seedSort(nextId);
    newOrder = nextSort - 1000;
  } else {
    newOrder = 0;
  }
  db.prepare('UPDATE chats SET sort_order = ? WHERE id = ? AND project_id = ?').run(newOrder, chatId, projectId);
}

function deleteChat(chatId: string): void {
  db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
}

function addMessage(chatId: string, message: { role: string; content: unknown; timestamp?: string; id?: string }): ChatHistoryEntry {
  const id = message.id || uuidv4();
  const timestamp = message.timestamp || new Date().toISOString();
  const contentStr = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  // Get next sort_order
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM chat_messages WHERE chat_id = ?').get(chatId) as any;
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  db.prepare('INSERT INTO chat_messages (id, chat_id, role, content, timestamp, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(id, chatId, message.role, contentStr, timestamp, sortOrder);

  // Update last_activity_at on the chat
  db.prepare("UPDATE chats SET last_activity_at = datetime('now') WHERE id = ?").run(chatId);

  return {
    id,
    role: message.role as 'user' | 'assistant',
    content: message.content,
    timestamp,
  };
}

function getChatMessages(chatId: string): ChatHistoryEntry[] {
  const rows = db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY sort_order').all(chatId) as any[];
  return rows.map(r => {
    let content: unknown;
    try {
      content = JSON.parse(r.content);
    } catch {
      content = r.content;
    }
    return {
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content,
      timestamp: r.timestamp,
    };
  });
}

// === Recording Methods ===

const MAX_RECORDINGS_PER_PROJECT = 20;

function saveRecording(projectId: string, recording: {
  id: string;
  scripts: SavedRecordingScript[];
  lines: string[];
  browserLines: string[];
  startedAt: number;
  stoppedAt: number;
}): void {
  const durationSecs = Math.round((recording.stoppedAt - recording.startedAt) / 1000);
  const startedAt = new Date(recording.startedAt).toISOString();
  const stoppedAt = new Date(recording.stoppedAt).toISOString();

  db.prepare(`
    INSERT INTO recordings (id, project_id, scripts, lines, browser_lines, line_count, browser_line_count, duration_secs, started_at, stopped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recording.id,
    projectId,
    JSON.stringify(recording.scripts),
    JSON.stringify(recording.lines),
    JSON.stringify(recording.browserLines),
    recording.lines.length,
    recording.browserLines.length,
    durationSecs,
    startedAt,
    stoppedAt,
  );

  // Enforce per-project limit: delete oldest beyond MAX
  const excess = db.prepare(`
    SELECT id FROM recordings WHERE project_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?
  `).all(projectId, MAX_RECORDINGS_PER_PROJECT) as any[];
  for (const row of excess) {
    db.prepare('DELETE FROM recordings WHERE id = ?').run(row.id);
  }
}

function listRecordings(projectId: string): SavedRecording[] {
  const rows = db.prepare('SELECT * FROM recordings WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[];
  return rows.map(mapRowToRecording);
}

function getRecording(recordingId: string): SavedRecording | null {
  const row = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recordingId) as any;
  if (!row) return null;
  return mapRowToRecording(row);
}

function deleteRecording(recordingId: string): void {
  db.prepare('DELETE FROM recordings WHERE id = ?').run(recordingId);
}

function mapRowToRecording(r: any): SavedRecording {
  return {
    id: r.id,
    projectId: r.project_id,
    scripts: JSON.parse(r.scripts),
    lines: JSON.parse(r.lines),
    browserLines: JSON.parse(r.browser_lines),
    lineCount: r.line_count,
    browserLineCount: r.browser_line_count,
    durationSecs: r.duration_secs,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    createdAt: r.created_at,
  };
}

export default {
  // Projects
  listProjects,
  listProjectsPaginated,
  searchProjectsPaginated,
  getProject,
  createProject,
  registerProject,
  updateProject,
  deleteProject,
  projectDirectoryExists,
  getProjectPath,
  // Scripts
  listScripts,
  createScript,
  updateScript,
  deleteScript,
  getScript,
  // Chats
  listChats,
  listChatsPaginated,
  createChat,
  getChat,
  updateChat,
  updateDraft,
  updateStashedInput,
  markChatUnread,
  markChatRead,
  markChatDismissed,
  setChatFavorite,
  reorderChat,
  touchChatActivity,
  deleteChat,
  addMessage,
  getChatMessages,
  // Recordings
  saveRecording,
  listRecordings,
  getRecording,
  deleteRecording,
};
