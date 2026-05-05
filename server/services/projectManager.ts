import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import db, { resolveDefaultAdapter, getDefaultModel } from './database.ts';
import gitService from './gitService.ts';
import sidebarSync from './sidebarSync.ts';
import type { Project, ProjectSummary, ProjectMode, Script, Chat, ChatHistoryEntry, ChatAdapter, ChatArtifact, ChatCategory, SavedRecording, SavedRecordingScript } from '../../shared/types/models.ts';

// Read project_id for a chat — used by activity broadcasts. Tiny prepared
// statement, cached at module scope so the hot path doesn't re-prepare.
const getChatProjectIdStmt = db.prepare('SELECT project_id FROM chats WHERE id = ?');
function getChatProjectId(chatId: string): string | null {
  const row = getChatProjectIdStmt.get(chatId) as { project_id: string } | undefined;
  return row?.project_id ?? null;
}

// === Project Methods ===

const PROJECT_SUMMARY_COLUMNS = `
  p.id, p.name, p.path, p.repo, p.created_at, p.mode, p.pinned, p.pinned_at,
  (SELECT COUNT(*) FROM scripts WHERE project_id = p.id) AS scriptsCount,
  (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chatsCount,
  COALESCE(
    (SELECT MAX(COALESCE(last_activity_at, created_at)) FROM chats WHERE project_id = p.id),
    p.created_at
  ) AS last_activity_at
`;

function mapRowToSummary(r: any): ProjectSummary {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    repo: r.repo || null,
    createdAt: r.created_at,
    scriptsCount: r.scriptsCount,
    chatsCount: r.chatsCount,
    mode: (r.mode as ProjectMode) || 'simple',
    pinned: !!r.pinned,
    pinnedAt: r.pinned_at || null,
    lastActivityAt: r.last_activity_at || r.created_at,
  };
}

function listProjects(): ProjectSummary[] {
  const rows = db.prepare(`
    SELECT ${PROJECT_SUMMARY_COLUMNS}
    FROM projects p
    ORDER BY last_activity_at DESC, p.created_at DESC
  `).all() as any[];
  return rows.map(mapRowToSummary);
}

function listProjectsPaginated(
  limit: number = 20,
  offset: number = 0,
  opts: { excludePinned?: boolean } = {},
): { projects: ProjectSummary[]; total: number } {
  // Home is rendered separately (always pinned to the very top) so we exclude
  // it from the recents list to avoid showing it twice. When the client is
  // showing a separate Pinned section, it passes excludePinned=1 so the
  // Recents list doesn't double up.
  const homePath = os.homedir();
  const filters: string[] = ['p.path != ?'];
  const params: any[] = [homePath];
  if (opts.excludePinned) {
    filters.push('p.pinned = 0');
  }
  const where = filters.join(' AND ');

  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM projects p WHERE ${where}`
  ).get(...params) as any;

  const rows = db.prepare(`
    SELECT ${PROJECT_SUMMARY_COLUMNS}
    FROM projects p
    WHERE ${where}
    ORDER BY last_activity_at DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return { projects: rows.map(mapRowToSummary), total };
}

function searchProjectsPaginated(
  search: string,
  limit: number = 20,
  offset: number = 0,
  opts: { excludePinned?: boolean } = {},
): { projects: ProjectSummary[]; total: number } {
  const pattern = `%${search}%`;
  const homePath = os.homedir();
  const filters: string[] = ['(p.name LIKE ? OR p.path LIKE ?)', 'p.path != ?'];
  const params: any[] = [pattern, pattern, homePath];
  if (opts.excludePinned) {
    filters.push('p.pinned = 0');
  }
  const where = filters.join(' AND ');

  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM projects p WHERE ${where}`
  ).get(...params) as any;

  const rows = db.prepare(`
    SELECT ${PROJECT_SUMMARY_COLUMNS}
    FROM projects p
    WHERE ${where}
    ORDER BY last_activity_at DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return { projects: rows.map(mapRowToSummary), total };
}

// === Home project ===
// The "Home" workspace is auto-managed and points at the user's home dir.
// It's used by the global "New Agent" entry point so users can spin up an
// ad-hoc agent without explicitly creating a workspace first. Recognised by
// path === os.homedir() so we never list it twice in the recents.
function isHomePath(p: string): boolean {
  return path.resolve(p) === path.resolve(os.homedir());
}

function getOrCreateHomeProject(): Project {
  const homePath = os.homedir();
  const existing = db.prepare('SELECT id, mode FROM projects WHERE path = ?').get(homePath) as { id: string; mode: string } | undefined;
  if (existing) {
    // Forward-fix: earlier revisions created Home in 'simple' mode, which
    // forces every chat to claw-chat regardless of the requested adapter.
    // Upgrade once on the next read.
    if (existing.mode === 'simple') {
      db.prepare("UPDATE projects SET mode = 'dev' WHERE id = ?").run(existing.id);
    }
    const proj = getProject(existing.id);
    if (proj) return proj;
  }
  // Create lazily.
  let id = 'home';
  if (db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) {
    id = `home-${uuidv4().slice(0, 8)}`;
  }
  const now = new Date().toISOString();
  const defaultAdapter = resolveDefaultAdapter();
  // Home runs in 'dev' mode so the user can pick any adapter (including
  // Claude Code) from the New Agent dialog. Simple mode would defense-in-
  // depth force every chat to claw-chat regardless of the requested adapter.
  db.prepare(
    'INSERT INTO projects (id, name, path, repo, created_at, default_adapter, mode) VALUES (?, ?, ?, NULL, ?, ?, ?)'
  ).run(id, 'Home', homePath, now, defaultAdapter, 'dev');
  ensureDefaultCategory(id);
  const proj = getProject(id);
  if (!proj) throw new Error('Failed to create Home project');
  return proj;
}

function getHomeProjectId(): string | null {
  const row = db.prepare('SELECT id FROM projects WHERE path = ?').get(os.homedir()) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Lightweight one-row project summary (with chatsCount + scriptsCount).
 * Used by the sidebar's Home row, which only needs counts not the full
 * chat history that getProject() returns. */
function getProjectSummary(projectId: string): ProjectSummary | null {
  const row = db.prepare(`
    SELECT ${PROJECT_SUMMARY_COLUMNS}
    FROM projects p
    WHERE p.id = ?
  `).get(projectId) as any;
  if (!row) return null;
  return mapRowToSummary(row);
}

function listPinnedProjects(): ProjectSummary[] {
  // Home is rendered separately as its own row at the top of the sidebar, so
  // it never belongs in the Pinned list even if pinned=1 was somehow set.
  const homePath = os.homedir();
  const rows = db.prepare(`
    SELECT ${PROJECT_SUMMARY_COLUMNS}
    FROM projects p
    WHERE p.pinned = 1 AND p.path != ?
    ORDER BY p.pinned_at DESC, p.created_at DESC
  `).all(homePath) as any[];
  return rows.map(mapRowToSummary);
}

// Manual order for the Pinned section. We reuse pinned_at as the sort key:
// each ordered id gets a synthetic ISO timestamp where index 0 (top) is the
// most recent. ORDER BY pinned_at DESC then renders them in the requested
// order. Ids that aren't currently pinned are ignored.
function reorderPinnedProjects(orderedIds: string[]): void {
  const update = db.prepare("UPDATE projects SET pinned_at = ? WHERE id = ? AND pinned = 1");
  const tx = db.transaction((ids: string[]) => {
    const baseMs = Date.now();
    for (let i = 0; i < ids.length; i++) {
      // Spaced 1s apart so the order is unambiguous and stable across timezones.
      const ts = new Date(baseMs - i * 1000).toISOString();
      update.run(ts, ids[i]);
    }
  });
  tx(orderedIds);
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

  ensureDefaultCategory(projectId);
  const scripts = listScripts(projectId);
  const chats = listChatsWithHistory(projectId);
  const categories = listCategories(projectId);

  return {
    id: row.id,
    name: row.name,
    path: row.path,
    repo: row.repo || null,
    createdAt: row.created_at,
    shellOverride: row.shell_override || null,
    defaultAdapter: (row.default_adapter as ChatAdapter) || resolveDefaultAdapter(),
    adapterOrder: parseAdapterOrder(row.adapter_order),
    aiNamingEnabled: (row.ai_naming_enabled as 'none' | 'on') || 'none',
    mode: (row.mode as ProjectMode) || 'simple',
    pinned: !!row.pinned,
    pinnedAt: row.pinned_at || null,
    scripts,
    chats,
    categories,
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
  const defaultAdapter = resolveDefaultAdapter();
  db.prepare('INSERT INTO projects (id, name, path, repo, created_at, default_adapter) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, targetPath, repoUrl || null, now, defaultAdapter);

  ensureDefaultCategory(id);

  const project: Project = {
    id,
    name,
    path: targetPath,
    repo: repoUrl || null,
    createdAt: now,
    shellOverride: null,
    defaultAdapter,
    adapterOrder: null,
    aiNamingEnabled: 'none',
    mode: 'simple',
    pinned: false,
    pinnedAt: null,
    scripts: [],
    chats: [],
    categories: listCategories(id),
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
  const defaultAdapter = resolveDefaultAdapter();
  db.prepare('INSERT INTO projects (id, name, path, repo, created_at, default_adapter) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, projectPath, null, now, defaultAdapter);

  ensureDefaultCategory(id);

  return {
    id,
    name,
    path: projectPath,
    repo: null,
    createdAt: now,
    shellOverride: null,
    defaultAdapter,
    adapterOrder: null,
    aiNamingEnabled: 'none',
    mode: 'simple',
    pinned: false,
    pinnedAt: null,
    scripts: [],
    chats: [],
    categories: listCategories(id),
  };
}

function updateProject(projectId: string, updates: { name?: string; path?: string; shellOverride?: string | null; defaultAdapter?: ChatAdapter; adapterOrder?: ChatAdapter[] | null; aiNamingEnabled?: 'none' | 'on'; mode?: ProjectMode; pinned?: boolean }): Project | null {
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
  if (updates.mode !== undefined) {
    db.prepare('UPDATE projects SET mode = ? WHERE id = ?').run(updates.mode, projectId);
  }
  if (updates.pinned !== undefined) {
    if (updates.pinned) {
      db.prepare("UPDATE projects SET pinned = 1, pinned_at = datetime('now') WHERE id = ?").run(projectId);
    } else {
      db.prepare('UPDATE projects SET pinned = 0, pinned_at = NULL WHERE id = ?').run(projectId);
    }
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
  const rows = db.prepare(
    'SELECT * FROM scripts WHERE project_id = ? ORDER BY sort_order IS NULL, sort_order, created_at'
  ).all(projectId) as any[];
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    command: r.command,
  }));
}

function reorderScripts(projectId: string, orderedIds: string[]): void {
  const existing = db.prepare('SELECT id FROM scripts WHERE project_id = ?').all(projectId) as Array<{ id: string }>;
  const validIds = new Set(existing.map(r => r.id));
  const update = db.prepare('UPDATE scripts SET sort_order = ? WHERE id = ? AND project_id = ?');
  const tx = db.transaction((ids: string[]) => {
    let order = 0;
    for (const id of ids) {
      if (validIds.has(id)) update.run(order++, id, projectId);
    }
  });
  tx(orderedIds);
}

function createScript(projectId: string, label: string, command: string): Script {
  const id = uuidv4();
  db.prepare('INSERT INTO scripts (id, project_id, label, command) VALUES (?, ?, ?, ?)').run(id, projectId, label, command);
  return { id, label, command };
}

function updateScript(scriptId: string, updates: { label?: string; command?: string }): Script | null {
  const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  if (!row) return null;

  if (updates.label !== undefined) db.prepare('UPDATE scripts SET label = ? WHERE id = ?').run(updates.label, scriptId);
  if (updates.command !== undefined) db.prepare('UPDATE scripts SET command = ? WHERE id = ?').run(updates.command, scriptId);

  const updated = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  return {
    id: updated.id,
    label: updated.label,
    command: updated.command,
  };
}

function deleteScript(scriptId: string): void {
  db.prepare('DELETE FROM scripts WHERE id = ?').run(scriptId);
}

function getScript(scriptId: string): Script | null {
  const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  if (!row) return null;
  return { id: row.id, label: row.label, command: row.command };
}

// === Chat Methods ===

// Activity-only ordering: newest message first. Categories are markers, not
// pins — they no longer float chats to the top.
const CHAT_SELECT = `
  SELECT c.*,
    cat.id   AS cat_id,
    cat.name AS cat_name,
    cat.emoji AS cat_emoji,
    cat.is_default AS cat_is_default,
    cat.sort_order AS cat_sort_order,
    cat.created_at AS cat_created_at
  FROM chats c
  LEFT JOIN chat_categories cat ON c.category_id = cat.id
`;
const CHAT_ORDER_CLAUSE = `ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC`;

function listChats(projectId: string): Chat[] {
  const rows = db.prepare(`${CHAT_SELECT} WHERE c.project_id = ? ${CHAT_ORDER_CLAUSE}`).all(projectId) as any[];
  return rows.map(r => mapRowToChatLite(r));
}

function listChatsPaginated(
  projectId: string,
  opts: { limit?: number; offset?: number; search?: string; categoryIds?: string[]; coverActivityAt?: string } = {},
): { chats: Chat[]; total: number } {
  let limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const filters: string[] = ['c.project_id = ?'];
  const params: any[] = [projectId];

  if (opts.search) {
    filters.push('(c.label LIKE ? OR c.description LIKE ?)');
    const pattern = `%${opts.search}%`;
    params.push(pattern, pattern);
  }
  if (opts.categoryIds && opts.categoryIds.length > 0) {
    const placeholders = opts.categoryIds.map(() => '?').join(',');
    filters.push(`c.category_id IN (${placeholders})`);
    params.push(...opts.categoryIds);
  }

  const where = filters.join(' AND ');
  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM chats c WHERE ${where}`
  ).get(...params) as any;

  // If the caller passed coverActivityAt (the oldest "interesting" tracker
  // chat's lastActivityAt), expand the limit so the result spans from the
  // top down through that chat — keeps the sidebar list continuous instead
  // of leaving a gap before an awaiting/working chat that sits below the
  // default page.
  if (offset === 0 && opts.coverActivityAt) {
    const coverRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM chats c WHERE ${where} AND COALESCE(c.last_activity_at, c.created_at) >= ?`
    ).get(...params, opts.coverActivityAt) as { cnt: number };
    if (coverRow.cnt > limit) limit = coverRow.cnt;
  }

  const rows = db.prepare(
    `${CHAT_SELECT} WHERE ${where} ${CHAT_ORDER_CLAUSE} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];

  return { chats: rows.map(r => mapRowToChat(r)), total };
}

function listChatsWithHistory(projectId: string): Chat[] {
  const chatRows = db.prepare(`${CHAT_SELECT} WHERE c.project_id = ? ${CHAT_ORDER_CLAUSE}`).all(projectId) as any[];
  return chatRows.map(r => mapRowToChat(r));
}

function rowToCategory(r: any): ChatCategory | null {
  if (!r.cat_id) return null;
  return {
    id: r.cat_id,
    projectId: r.project_id,
    name: r.cat_name,
    emoji: r.cat_emoji,
    isDefault: !!r.cat_is_default,
    sortOrder: r.cat_sort_order ?? 0,
    createdAt: r.cat_created_at,
  };
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
    adapter: (r.adapter as ChatAdapter) || 'claw-chat',
    model: r.model || null,
    ccConversationId: r.cc_conversation_id || null,
    sessionId: r.session_id || null,
    draftMessage: r.draft_message || null,
    stashedInput: r.stashed_input || null,
    unread: !!r.unread,
    categoryId: r.category_id || null,
    category: rowToCategory(r),
  };
}

function mapRowToChatLite(r: any): Chat {
  return {
    id: r.id,
    label: r.label,
    description: r.description || null,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at || r.created_at,
    history: [],
    sdkSessionId: r.sdk_session_id || null,
    adapter: (r.adapter as ChatAdapter) || 'claw-chat',
    model: r.model || null,
    ccConversationId: r.cc_conversation_id || null,
    sessionId: r.session_id || null,
    draftMessage: r.draft_message || null,
    stashedInput: r.stashed_input || null,
    unread: !!r.unread,
    categoryId: r.category_id || null,
    category: rowToCategory(r),
  };
}

function createChat(projectId: string, label?: string, adapter?: ChatAdapter): Chat {
  const id = uuidv4();
  const now = new Date().toISOString();
  const chatAdapter = adapter || 'claw-chat';
  // Seed chat.model from the adapter's default_model setting (if any). NULL
  // is fine — runtime falls back to the same default at session start.
  const model = getDefaultModel(chatAdapter);
  db.prepare(
    'INSERT INTO chats (id, project_id, label, adapter, model, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, label || 'New Chat', chatAdapter, model, now, now);
  return {
    id,
    label: label || 'New Chat',
    description: null,
    createdAt: now,
    lastActivityAt: now,
    history: [],
    sdkSessionId: null,
    adapter: chatAdapter,
    model,
    ccConversationId: null,
    sessionId: null,
    draftMessage: null,
    stashedInput: null,
    unread: false,
    categoryId: null,
    category: null,
  };
}

function getChat(chatId: string): Chat | null {
  const row = db.prepare(`${CHAT_SELECT} WHERE c.id = ?`).get(chatId) as any;
  if (!row) return null;
  return mapRowToChat(row);
}

function updateChat(chatId: string, updates: { label?: string; description?: string | null; sdkSessionId?: string | null; ccConversationId?: string | null; sessionId?: string | null; draftMessage?: string | null; model?: string | null }): Chat | null {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any;
  if (!row) return null;

  if (updates.label !== undefined) db.prepare('UPDATE chats SET label = ? WHERE id = ?').run(updates.label, chatId);
  if (updates.description !== undefined) db.prepare('UPDATE chats SET description = ? WHERE id = ?').run(updates.description, chatId);
  if (updates.sdkSessionId !== undefined) db.prepare('UPDATE chats SET sdk_session_id = ? WHERE id = ?').run(updates.sdkSessionId, chatId);
  if (updates.ccConversationId !== undefined) db.prepare('UPDATE chats SET cc_conversation_id = ? WHERE id = ?').run(updates.ccConversationId, chatId);
  if (updates.sessionId !== undefined) db.prepare('UPDATE chats SET session_id = ? WHERE id = ?').run(updates.sessionId, chatId);
  if (updates.draftMessage !== undefined) db.prepare('UPDATE chats SET draft_message = ? WHERE id = ?').run(updates.draftMessage, chatId);
  if (updates.model !== undefined) db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(updates.model, chatId);

  return getChat(chatId);
}

function touchChatActivity(chatId: string): void {
  db.prepare("UPDATE chats SET last_activity_at = datetime('now') WHERE id = ?").run(chatId);
  const projectId = getChatProjectId(chatId);
  if (projectId) sidebarSync.projectActivity({ projectId, lastActivityAt: new Date().toISOString() });
}

function updateDraft(chatId: string, text: string): void {
  db.prepare('UPDATE chats SET draft_message = ? WHERE id = ?').run(text || null, chatId);
}

function updateStashedInput(chatId: string, text: string): void {
  db.prepare('UPDATE chats SET stashed_input = ? WHERE id = ?').run(text || null, chatId);
}

function markChatUnread(chatId: string): void {
  db.prepare('UPDATE chats SET unread = 1 WHERE id = ?').run(chatId);
}

function markChatRead(chatId: string): void {
  db.prepare('UPDATE chats SET unread = 0 WHERE id = ?').run(chatId);
}

function setChatCategory(chatId: string, categoryId: string | null): void {
  if (categoryId === null) {
    db.prepare('UPDATE chats SET category_id = NULL WHERE id = ?').run(chatId);
    return;
  }
  // Validate the category exists and belongs to the same project as the chat.
  const chat = db.prepare('SELECT project_id FROM chats WHERE id = ?').get(chatId) as { project_id: string } | undefined;
  if (!chat) throw new Error('Chat not found');
  const cat = db.prepare('SELECT project_id FROM chat_categories WHERE id = ?').get(categoryId) as { project_id: string } | undefined;
  if (!cat) throw new Error('Category not found');
  if (cat.project_id !== chat.project_id) throw new Error('Category belongs to a different project');
  db.prepare('UPDATE chats SET category_id = ? WHERE id = ?').run(categoryId, chatId);
}

// === Category Methods ===

function ensureDefaultCategory(projectId: string): ChatCategory {
  const existing = db.prepare(
    'SELECT * FROM chat_categories WHERE project_id = ? AND is_default = 1 LIMIT 1'
  ).get(projectId) as any;
  if (existing) {
    return {
      id: existing.id,
      projectId: existing.project_id,
      name: existing.name,
      emoji: existing.emoji,
      isDefault: !!existing.is_default,
      sortOrder: existing.sort_order ?? 0,
      createdAt: existing.created_at,
    };
  }
  const id = `${projectId}-favorites-${uuidv4().slice(0, 8)}`;
  db.prepare(
    "INSERT INTO chat_categories (id, project_id, name, emoji, is_default, sort_order) VALUES (?, ?, 'Favorites', '⭐', 1, 0)"
  ).run(id, projectId);
  const row = db.prepare('SELECT * FROM chat_categories WHERE id = ?').get(id) as any;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    emoji: row.emoji,
    isDefault: !!row.is_default,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  };
}

function listCategories(projectId: string): ChatCategory[] {
  ensureDefaultCategory(projectId);
  const rows = db.prepare(
    'SELECT * FROM chat_categories WHERE project_id = ? ORDER BY is_default DESC, sort_order ASC, created_at ASC'
  ).all(projectId) as any[];
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    emoji: r.emoji,
    isDefault: !!r.is_default,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
  }));
}

function getCategory(categoryId: string): ChatCategory | null {
  const r = db.prepare('SELECT * FROM chat_categories WHERE id = ?').get(categoryId) as any;
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    emoji: r.emoji,
    isDefault: !!r.is_default,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
  };
}

function createCategory(projectId: string, name: string, emoji: string): ChatCategory {
  const trimmedName = name.trim();
  const trimmedEmoji = emoji.trim();
  if (!trimmedName) throw new Error('Category name required');
  if (!trimmedEmoji) throw new Error('Category emoji required');
  const id = uuidv4();
  const next = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM chat_categories WHERE project_id = ?'
  ).get(projectId) as { next: number };
  db.prepare(
    'INSERT INTO chat_categories (id, project_id, name, emoji, is_default, sort_order) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(id, projectId, trimmedName, trimmedEmoji, next.next);
  return getCategory(id)!;
}

function updateCategory(categoryId: string, updates: { name?: string; emoji?: string }): ChatCategory | null {
  const row = db.prepare('SELECT * FROM chat_categories WHERE id = ?').get(categoryId) as any;
  if (!row) return null;
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) throw new Error('Category name required');
    db.prepare('UPDATE chat_categories SET name = ? WHERE id = ?').run(trimmed, categoryId);
  }
  if (updates.emoji !== undefined) {
    const trimmed = updates.emoji.trim();
    if (!trimmed) throw new Error('Category emoji required');
    db.prepare('UPDATE chat_categories SET emoji = ? WHERE id = ?').run(trimmed, categoryId);
  }
  return getCategory(categoryId);
}

function deleteCategory(categoryId: string): void {
  const row = db.prepare('SELECT is_default FROM chat_categories WHERE id = ?').get(categoryId) as { is_default: number } | undefined;
  if (!row) return;
  if (row.is_default) throw new Error('Cannot delete the default Favorites category');
  // Clear the foreign key on any chats pointing at this category.
  db.prepare('UPDATE chats SET category_id = NULL WHERE category_id = ?').run(categoryId);
  db.prepare('DELETE FROM chat_categories WHERE id = ?').run(categoryId);
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

  // Sidebar live-sync: bump Recents ordering. Debounced inside sidebarSync
  // so a chatty agent run doesn't saturate the socket — at most one emit
  // per project every 2 seconds.
  const projectId = getChatProjectId(chatId);
  if (projectId) sidebarSync.projectActivity({ projectId, lastActivityAt: new Date().toISOString() });

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

// === Chat Artifact Methods ===

function createArtifact(chatId: string, params: { path: string; label?: string | null; size?: number | null; messageId?: string | null }): ChatArtifact {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO chat_artifacts (id, chat_id, message_id, path, label, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, chatId, params.messageId || null, params.path, params.label || null, params.size ?? null, now);
  return {
    id,
    chatId,
    messageId: params.messageId || null,
    path: params.path,
    label: params.label || null,
    size: params.size ?? null,
    createdAt: now,
  };
}

function listArtifactsByChat(chatId: string): ChatArtifact[] {
  const rows = db.prepare(
    'SELECT id, chat_id, message_id, path, label, size, created_at FROM chat_artifacts WHERE chat_id = ? ORDER BY created_at ASC'
  ).all(chatId) as any[];
  return rows.map(r => ({
    id: r.id,
    chatId: r.chat_id,
    messageId: r.message_id || null,
    path: r.path,
    label: r.label || null,
    size: typeof r.size === 'number' ? r.size : null,
    createdAt: r.created_at,
  }));
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
  listPinnedProjects,
  reorderPinnedProjects,
  getOrCreateHomeProject,
  getHomeProjectId,
  getProjectSummary,
  isHomePath,
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
  reorderScripts,
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
  setChatCategory,
  touchChatActivity,
  deleteChat,
  addMessage,
  getChatMessages,
  // Categories
  ensureDefaultCategory,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  // Artifacts
  createArtifact,
  listArtifactsByChat,
  // Recordings
  saveRecording,
  listRecordings,
  getRecording,
  deleteRecording,
};
