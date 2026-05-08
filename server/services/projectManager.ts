import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import db, { resolveDefaultAdapter, getDefaultModel } from './database.ts';
import gitService from './gitService.ts';
import sidebarSync from './sidebarSync.ts';
import type { Project, ProjectSummary, ProjectMode, Script, Chat, ChatHistoryEntry, ChatAdapter, ChatArtifact, ChatCategory, SavedRecording, SavedRecordingScript, ChatBrowserTab, ChatBrowserSession, BrowserViewportMode, BrowserTakeoverEvent } from '../../shared/types/models.ts';

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
  (SELECT COUNT(*) FROM chats WHERE project_id = p.id AND tab_opened_at IS NOT NULL) AS openTabsCount,
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
    openTabsCount: r.openTabsCount ?? 0,
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
    ORDER BY (openTabsCount > 0) DESC, last_activity_at DESC, p.created_at DESC
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
    ORDER BY (openTabsCount > 0) DESC, last_activity_at DESC, p.created_at DESC
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
    ORDER BY (openTabsCount > 0) DESC, last_activity_at DESC, p.created_at DESC
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
  opts: { limit?: number; offset?: number; search?: string; categoryIds?: string[]; coverActivityAt?: string; tabsOnly?: boolean } = {},
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
  // tabsOnly: sidebar query — only chats currently in the open-tabs set.
  // Pinned tabs sort first, then unpinned by tab_opened_at.
  if (opts.tabsOnly) {
    filters.push('c.tab_opened_at IS NOT NULL');
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

  // Sidebar tabs: pinned first (newest pin on top — pin order is still
  // chronological for now), then unpinned by user-controlled tab_order
  // ascending. tab_opened_at is the tiebreaker for legacy rows that haven't
  // been assigned an order yet (NULLS LAST keeps them at the bottom).
  const orderClause = opts.tabsOnly
    ? 'ORDER BY (c.tab_pinned_at IS NOT NULL) DESC, c.tab_pinned_at DESC, (c.tab_order IS NULL), c.tab_order ASC, c.tab_opened_at DESC'
    : CHAT_ORDER_CLAUSE;
  const rows = db.prepare(
    `${CHAT_SELECT} WHERE ${where} ${orderClause} LIMIT ? OFFSET ?`
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

function parseArmedTools(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function getArmedTools(chatId: string): string[] {
  const row = db.prepare('SELECT armed_tools FROM chats WHERE id = ?').get(chatId) as { armed_tools: string | null } | undefined;
  return parseArmedTools(row?.armed_tools);
}

function setArmedTools(chatId: string, tools: string[]): void {
  // De-dup + filter to known shape; persist as JSON string.
  const clean = Array.from(new Set(tools.filter(t => typeof t === 'string')));
  db.prepare('UPDATE chats SET armed_tools = ? WHERE id = ?').run(JSON.stringify(clean), chatId);
}

function armTool(chatId: string, toolId: string): string[] {
  const current = getArmedTools(chatId);
  if (!current.includes(toolId)) current.push(toolId);
  setArmedTools(chatId, current);
  return current;
}

function disarmTool(chatId: string, toolId: string): string[] {
  const current = getArmedTools(chatId).filter(t => t !== toolId);
  setArmedTools(chatId, current);
  return current;
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
    tabOpenedAt: r.tab_opened_at || null,
    tabPinnedAt: r.tab_pinned_at || null,
    tabOrder: r.tab_order ?? null,
    armedTools: parseArmedTools(r.armed_tools),
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
    tabOpenedAt: r.tab_opened_at || null,
    tabPinnedAt: r.tab_pinned_at || null,
    tabOrder: r.tab_order ?? null,
    armedTools: parseArmedTools(r.armed_tools),
  };
}

function createChat(projectId: string, label?: string, adapter?: ChatAdapter): Chat {
  const id = uuidv4();
  const now = new Date().toISOString();
  const chatAdapter = adapter || 'claw-chat';
  // Seed chat.model from the adapter's default_model setting (if any). NULL
  // is fine — runtime falls back to the same default at session start.
  const model = getDefaultModel(chatAdapter);
  const order = nextTabOrder(projectId);
  // Auto-open as a sidebar tab on creation: a brand-new chat the user just
  // explicitly created is, by definition, something they want to see in the
  // sidebar. (Tabs are dismissable — they can close it with the X.) New
  // chats land at the bottom of the unpinned tab list; the user reorders
  // explicitly via drag-drop.
  db.prepare(
    'INSERT INTO chats (id, project_id, label, adapter, model, created_at, last_activity_at, tab_opened_at, tab_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, label || 'New Chat', chatAdapter, model, now, now, now, order);
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
    tabOpenedAt: now,
    tabPinnedAt: null,
    tabOrder: order,
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

  const labelChanged = updates.label !== undefined && updates.label !== row.label;

  if (updates.label !== undefined) db.prepare('UPDATE chats SET label = ? WHERE id = ?').run(updates.label, chatId);
  if (updates.description !== undefined) db.prepare('UPDATE chats SET description = ? WHERE id = ?').run(updates.description, chatId);
  if (updates.sdkSessionId !== undefined) db.prepare('UPDATE chats SET sdk_session_id = ? WHERE id = ?').run(updates.sdkSessionId, chatId);
  if (updates.ccConversationId !== undefined) db.prepare('UPDATE chats SET cc_conversation_id = ? WHERE id = ?').run(updates.ccConversationId, chatId);
  if (updates.sessionId !== undefined) db.prepare('UPDATE chats SET session_id = ? WHERE id = ?').run(updates.sessionId, chatId);
  if (updates.draftMessage !== undefined) db.prepare('UPDATE chats SET draft_message = ? WHERE id = ?').run(updates.draftMessage, chatId);
  if (updates.model !== undefined) db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(updates.model, chatId);

  // Push label changes through the sidebar sync channel so every client's
  // lazy-fetched chat cache picks up the new name. Without this, sockets
  // that already loaded the project see "New Chat" forever even after
  // auto-rename. (route handlers also push their own meta-changed for
  // belt-and-braces — sidebarSync.chatMetaChanged is idempotent.)
  if (labelChanged) {
    sidebarSync.chatMetaChanged({
      projectId: row.project_id,
      chatId,
      label: updates.label!,
    });
  }

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

// ── Sidebar tab state ────────────────────────────────────────────────
// Returns true iff the call actually changed the chat's tab state, so callers
// can skip a sync broadcast when nothing moved (avoids noise on auto-promote
// hot paths where the chat was already an open tab).

// Compute the next tab_order value within a project — newly opened tabs go
// to the bottom of the unpinned list. (Pinned tabs sort separately above.)
function nextTabOrder(projectId: string): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(tab_order), 0) + 1 AS next FROM chats WHERE project_id = ?'
  ).get(projectId) as { next: number };
  return row.next;
}

function openChatTab(chatId: string): boolean {
  const projectIdRow = db.prepare('SELECT project_id FROM chats WHERE id = ?').get(chatId) as
    | { project_id: string } | undefined;
  if (!projectIdRow) return false;
  const order = nextTabOrder(projectIdRow.project_id);
  const result = db.prepare(
    "UPDATE chats SET tab_opened_at = COALESCE(tab_opened_at, datetime('now')), tab_order = COALESCE(tab_order, ?) WHERE id = ? AND tab_opened_at IS NULL"
  ).run(order, chatId);
  return result.changes > 0;
}

function closeChatTab(chatId: string): boolean {
  // Closing clears tab_order too — a future re-open should re-append at the
  // bottom rather than slot back into the user's old position.
  const result = db.prepare(
    'UPDATE chats SET tab_opened_at = NULL, tab_pinned_at = NULL, tab_order = NULL WHERE id = ? AND tab_opened_at IS NOT NULL'
  ).run(chatId);
  return result.changes > 0;
}

function pinChatTab(chatId: string): boolean {
  // Pin always implies open. Idempotent on already-pinned (changes=0).
  // Also assigns tab_order if the chat wasn't already an open tab so the
  // unpin path puts it at a sensible spot.
  const projectIdRow = db.prepare('SELECT project_id FROM chats WHERE id = ?').get(chatId) as
    | { project_id: string } | undefined;
  if (!projectIdRow) return false;
  const order = nextTabOrder(projectIdRow.project_id);
  const result = db.prepare(`
    UPDATE chats
    SET tab_pinned_at = datetime('now'),
        tab_opened_at = COALESCE(tab_opened_at, datetime('now')),
        tab_order = COALESCE(tab_order, ?)
    WHERE id = ? AND tab_pinned_at IS NULL
  `).run(order, chatId);
  return result.changes > 0;
}

function unpinChatTab(chatId: string): boolean {
  // Unpin keeps the tab open — only clears the pinned-at marker.
  const result = db.prepare(
    'UPDATE chats SET tab_pinned_at = NULL WHERE id = ? AND tab_pinned_at IS NOT NULL'
  ).run(chatId);
  return result.changes > 0;
}

/** Reorder open tabs in a project. `orderedIds` is the new top-to-bottom
 *  order. Chats not in the list keep their existing tab_order — useful when
 *  the client only reorders the unpinned section but pinned tabs stay put.
 *  Returns true on success, false if the project doesn't exist. */
function reorderChatTabs(projectId: string, orderedIds: string[]): boolean {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return false;
  const stmt = db.prepare('UPDATE chats SET tab_order = ? WHERE id = ? AND project_id = ? AND tab_opened_at IS NOT NULL');
  const tx = db.transaction((ids: string[]) => {
    ids.forEach((id, idx) => stmt.run(idx + 1, id, projectId));
  });
  tx(orderedIds);
  return true;
}

/** Read the current tab state — used by routes to build the broadcast
 *  payload after a mutation. */
function getChatTabState(chatId: string): { tabOpenedAt: string | null; tabPinnedAt: string | null } | null {
  const row = db.prepare('SELECT tab_opened_at, tab_pinned_at FROM chats WHERE id = ?').get(chatId) as
    | { tab_opened_at: string | null; tab_pinned_at: string | null }
    | undefined;
  if (!row) return null;
  return { tabOpenedAt: row.tab_opened_at, tabPinnedAt: row.tab_pinned_at };
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

  // Auto-promote to sidebar tab on user messages: sending a message is the
  // commitment signal that turns a previewed chat into a real tab.
  // Assistant messages don't trigger this — agent activity surfaces via the
  // unread / awaiting events from activeChatsTracker instead.
  if (message.role === 'user' && projectId && openChatTab(chatId)) {
    const state = getChatTabState(chatId);
    sidebarSync.chatMetaChanged({
      projectId,
      chatId,
      tabOpenedAt: state?.tabOpenedAt ?? null,
      tabPinnedAt: state?.tabPinnedAt ?? null,
    });
  }

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

// === Browser Tab + Session Methods ===

function getOrCreateBrowserTab(chatId: string, projectId: string): ChatBrowserTab {
  const existing = db.prepare(
    'SELECT chat_id, project_id, tab_id, current_url, viewport_mode, created_at FROM chat_browser_tabs WHERE chat_id = ?'
  ).get(chatId) as any;
  if (existing) {
    return {
      chatId: existing.chat_id,
      projectId: existing.project_id,
      tabId: existing.tab_id,
      currentUrl: existing.current_url || null,
      viewportMode: (existing.viewport_mode || 'desktop') as BrowserViewportMode,
      createdAt: existing.created_at,
    };
  }
  // Tab id is opaque to the dashboard — playwrightSessionManager assigns it on
  // tab creation. We seed a deterministic placeholder; the manager replaces it
  // via updateBrowserTab once the real tab exists.
  const tabId = `chat_${chatId}`;
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO chat_browser_tabs (chat_id, project_id, tab_id, viewport_mode, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(chatId, projectId, tabId, 'desktop', now);
  return { chatId, projectId, tabId, currentUrl: null, viewportMode: 'desktop', createdAt: now };
}

function updateBrowserTab(
  chatId: string,
  updates: { tabId?: string; currentUrl?: string | null; viewportMode?: BrowserViewportMode },
): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.tabId !== undefined) { fields.push('tab_id = ?'); values.push(updates.tabId); }
  if (updates.currentUrl !== undefined) { fields.push('current_url = ?'); values.push(updates.currentUrl); }
  if (updates.viewportMode !== undefined) { fields.push('viewport_mode = ?'); values.push(updates.viewportMode); }
  if (fields.length === 0) return;
  values.push(chatId);
  db.prepare(`UPDATE chat_browser_tabs SET ${fields.join(', ')} WHERE chat_id = ?`).run(...values);
}

function listBrowserTabsByProject(projectId: string): ChatBrowserTab[] {
  const rows = db.prepare(
    'SELECT chat_id, project_id, tab_id, current_url, viewport_mode, created_at FROM chat_browser_tabs WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];
  return rows.map(r => ({
    chatId: r.chat_id,
    projectId: r.project_id,
    tabId: r.tab_id,
    currentUrl: r.current_url || null,
    viewportMode: (r.viewport_mode || 'desktop') as BrowserViewportMode,
    createdAt: r.created_at,
  }));
}

function createBrowserSession(
  chatId: string,
  params: { label?: string | null; messageId?: string | null },
): ChatBrowserSession {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO chat_browser_sessions (id, chat_id, message_id, label, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, chatId, params.messageId || null, params.label || null, 'active', now);
  return {
    id,
    chatId,
    messageId: params.messageId || null,
    label: params.label || null,
    status: 'active',
    createdAt: now,
    closedAt: null,
  };
}

function closeBrowserSession(sessionId: string): void {
  db.prepare(
    "UPDATE chat_browser_sessions SET status = 'closed', closed_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), sessionId);
}

function listBrowserSessionsByChat(chatId: string): ChatBrowserSession[] {
  const rows = db.prepare(
    'SELECT id, chat_id, message_id, label, status, created_at, closed_at FROM chat_browser_sessions WHERE chat_id = ? ORDER BY created_at ASC'
  ).all(chatId) as any[];
  return rows.map(r => ({
    id: r.id,
    chatId: r.chat_id,
    messageId: r.message_id || null,
    label: r.label || null,
    status: r.status as 'active' | 'closed',
    createdAt: r.created_at,
    closedAt: r.closed_at || null,
  }));
}

function recordTakeoverEvent(
  chatId: string,
  takeoverId: string,
  eventType: string,
  description: string,
  raw?: string | null,
): BrowserTakeoverEvent {
  const result = db.prepare(
    'INSERT INTO browser_takeover_events (chat_id, takeover_id, event_type, description, raw) VALUES (?, ?, ?, ?, ?)'
  ).run(chatId, takeoverId, eventType, description, raw ?? null);
  const ts = new Date().toISOString();
  return {
    id: Number(result.lastInsertRowid),
    chatId,
    takeoverId,
    eventType,
    description,
    raw: raw ?? null,
    ts,
  };
}

// === Manual (user-owned) browser tabs ===

interface ManualTabRow {
  id: string;
  projectId: string;
  label: string | null;
  currentUrl: string | null;
  viewportMode: BrowserViewportMode;
  createdAt: string;
}

function createManualTab(projectId: string, params: { label?: string | null }): ManualTabRow {
  const id = `manual_${uuidv4()}`;
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO manual_browser_tabs (id, project_id, label, viewport_mode, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, projectId, params.label || null, 'desktop', now);
  return { id, projectId, label: params.label || null, currentUrl: null, viewportMode: 'desktop', createdAt: now };
}

function listManualTabs(projectId: string): ManualTabRow[] {
  const rows = db.prepare(
    'SELECT id, project_id, label, current_url, viewport_mode, created_at FROM manual_browser_tabs WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as any[];
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    label: r.label || null,
    currentUrl: r.current_url || null,
    viewportMode: (r.viewport_mode || 'desktop') as BrowserViewportMode,
    createdAt: r.created_at,
  }));
}

function updateManualTab(
  tabId: string,
  updates: { label?: string | null; currentUrl?: string | null; viewportMode?: BrowserViewportMode },
): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.label !== undefined) { fields.push('label = ?'); values.push(updates.label); }
  if (updates.currentUrl !== undefined) { fields.push('current_url = ?'); values.push(updates.currentUrl); }
  if (updates.viewportMode !== undefined) { fields.push('viewport_mode = ?'); values.push(updates.viewportMode); }
  if (fields.length === 0) return;
  values.push(tabId);
  db.prepare(`UPDATE manual_browser_tabs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteManualTab(tabId: string): void {
  db.prepare('DELETE FROM manual_browser_tabs WHERE id = ?').run(tabId);
}

function getManualTabProjectId(tabId: string): string | null {
  const row = db.prepare('SELECT project_id FROM manual_browser_tabs WHERE id = ?').get(tabId) as { project_id: string } | undefined;
  return row?.project_id ?? null;
}

function listTakeoverEvents(chatId: string, takeoverId: string): BrowserTakeoverEvent[] {
  const rows = db.prepare(
    'SELECT id, chat_id, takeover_id, event_type, description, raw, ts FROM browser_takeover_events WHERE chat_id = ? AND takeover_id = ? ORDER BY id ASC'
  ).all(chatId, takeoverId) as any[];
  return rows.map(r => ({
    id: r.id,
    chatId: r.chat_id,
    takeoverId: r.takeover_id,
    eventType: r.event_type,
    description: r.description,
    raw: r.raw || null,
    ts: r.ts,
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
  openChatTab,
  closeChatTab,
  pinChatTab,
  unpinChatTab,
  reorderChatTabs,
  getChatTabState,
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
  // Chat → project lookup (used by features that work with bare chatIds).
  getChatProjectId,
  // Per-chat armed tools
  getArmedTools,
  setArmedTools,
  armTool,
  disarmTool,
  // Browser
  getOrCreateBrowserTab,
  updateBrowserTab,
  listBrowserTabsByProject,
  createBrowserSession,
  closeBrowserSession,
  listBrowserSessionsByChat,
  recordTakeoverEvent,
  listTakeoverEvents,
  // Manual browser tabs
  createManualTab,
  listManualTabs,
  updateManualTab,
  deleteManualTab,
  getManualTabProjectId,
  // Recordings
  saveRecording,
  listRecordings,
  getRecording,
  deleteRecording,
};
