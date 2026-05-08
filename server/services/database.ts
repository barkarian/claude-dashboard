import crypto from 'crypto';
import os from 'os';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In desktop mode the server runs inside a read-only .app bundle,
// so the database must live in a user-writable location.
const dataDir = process.env.CLAW_DESKTOP === '1'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'com.claw-dev.desktop', 'data')
  : path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'dashboard.sqlite');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    repo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    command TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'New Chat',
    sdk_session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    sort_order INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
  CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON chat_messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_order ON chat_messages(chat_id, sort_order);

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tunnel_credentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    api_key TEXT NOT NULL,
    user_subdomain TEXT NOT NULL,
    user_id TEXT,
    email TEXT,
    username TEXT,
    plan TEXT DEFAULT 'free',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Recordings table (per-project terminal recording persistence)
db.exec(`
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scripts TEXT NOT NULL,
    lines TEXT NOT NULL,
    browser_lines TEXT NOT NULL DEFAULT '[]',
    line_count INTEGER NOT NULL DEFAULT 0,
    browser_line_count INTEGER NOT NULL DEFAULT 0,
    duration_secs INTEGER,
    started_at TEXT NOT NULL,
    stopped_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_recordings_project ON recordings(project_id);
`);

// --- Migrations ---
// Drop legacy autostart column from scripts (feature removed).
// Requires SQLite 3.35+ (shipped with recent better-sqlite3 builds).
try {
  db.exec(`ALTER TABLE scripts DROP COLUMN autostart`);
} catch {
  // Column already gone (or never existed) — ignore
}

// Add shell_override column to projects (safe to re-run)
try {
  db.exec(`ALTER TABLE projects ADD COLUMN shell_override TEXT`);
} catch {
  // Column already exists — ignore
}

// Add default_adapter column to projects
try {
  db.exec(`ALTER TABLE projects ADD COLUMN default_adapter TEXT DEFAULT 'claw-chat'`);
} catch {
  // Column already exists — ignore
}

// Add adapter column to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN adapter TEXT DEFAULT 'claw-chat'`);
} catch {
  // Column already exists — ignore
}

// Add model column to chats (adapter-opaque model identifier; NULL = fall
// back to adapter's default_model setting at session start)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN model TEXT`);
} catch {
  // Column already exists — ignore
}

// Add cc_conversation_id column to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN cc_conversation_id TEXT`);
} catch {
  // Column already exists — ignore
}

// Add last_activity_at column to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN last_activity_at TEXT`);
  // Backfill: delete old chats without last_activity_at so stale data is cleaned up
  db.exec(`DELETE FROM chats WHERE last_activity_at IS NULL`);
} catch {
  // Column already exists — ignore
}

// Add draft_message column to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN draft_message TEXT`);
} catch {
  // Column already exists — ignore
}

// Add stashed_input column to chats (pre-navigation prompt text)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN stashed_input TEXT`);
} catch {
  // Column already exists — ignore
}

// Add unread column to chats (set when agent finishes in background)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN unread INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

// Add unified session_id column to chats (replaces cc_conversation_id + sdk_session_id)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN session_id TEXT`);
  // Backfill from existing columns
  db.exec(`UPDATE chats SET session_id = COALESCE(cc_conversation_id, sdk_session_id) WHERE session_id IS NULL`);
} catch {
  // Column already exists — ignore
}

// Add pinned column to chats (keeps chat in sidebar tracker after reading until manually dismissed)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

// Add description column to chats (AI-generated chat summary for search & display)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN description TEXT`);
} catch {
  // Column already exists — ignore
}

// Migrate old keywords column to description if it exists
try {
  db.exec(`UPDATE chats SET description = keywords WHERE description IS NULL AND keywords IS NOT NULL`);
  // We don't drop the old column — SQLite makes that hard and it's harmless
} catch {
  // keywords column doesn't exist — nothing to migrate
}

// Add ai_naming_enabled column to projects
try {
  db.exec(`ALTER TABLE projects ADD COLUMN ai_naming_enabled TEXT DEFAULT 'none'`);
} catch {
  // Column already exists — ignore
}

// Add adapter_config column to chats (per-chat adapter configuration, JSON)
try {
  db.exec(`ALTER TABLE chats ADD COLUMN adapter_config TEXT`);
} catch {
  // Column already exists — ignore
}

// Add adapter_configs column to projects (per-project adapter settings, JSON map)
try {
  db.exec(`ALTER TABLE projects ADD COLUMN adapter_configs TEXT DEFAULT '{}'`);
} catch {
  // Column already exists — ignore
}

// Add adapter_order column to projects (JSON array of adapter IDs; index 0 is the default).
try {
  db.exec(`ALTER TABLE projects ADD COLUMN adapter_order TEXT`);
} catch {
  // Column already exists — ignore
}

// Add sort_order column to chats (REAL). Stored as a ms-since-epoch timestamp: a
// frozen "effective activity" date the user picked by dragging. NULL = use live
// last_activity_at. Previous revisions of this code stored negative seeded values;
// those are wiped below so old rows fall back to activity-based ordering.
try {
  db.exec(`ALTER TABLE chats ADD COLUMN sort_order REAL`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`UPDATE chats SET sort_order = NULL WHERE sort_order < 0`);
} catch {
  // Table/column missing — nothing to clean up.
}

// Add favorite column to chats (1 = starred). Distinct from `pinned` which is the active-chats tracker flag.
// Superseded by chat_categories (below) — kept for migration backfill, no longer read by the app.
try {
  db.exec(`ALTER TABLE chats ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

// Per-project chat categories (labels with an emoji). Each project has a built-in
// "Favorites" category (is_default=1, undeletable) and may have any number of
// custom categories. Each chat may belong to at most one category.
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_categories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_categories_project ON chat_categories(project_id);
`);

// Chat → category pointer. NULL = uncategorised. Cleared automatically if the
// category row is deleted (ON DELETE SET NULL would be cleaner but SQLite ALTER
// can't add a FK; we handle deletion in the route handler).
try {
  db.exec(`ALTER TABLE chats ADD COLUMN category_id TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_category ON chats(category_id)`);
} catch {
  // Already exists — ignore
}

// One-shot: seed a default "Favorites" category in every existing project and
// migrate the legacy `favorite` boolean to a category_id pointer. Gated by a
// settings flag so it runs at most once per database.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.favorites_to_categories_at'").get();
  if (!flag) {
    const projects = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
    const insertCat = db.prepare(
      "INSERT INTO chat_categories (id, project_id, name, emoji, is_default, sort_order) VALUES (?, ?, 'Favorites', '⭐', 1, 0)"
    );
    const updateChats = db.prepare(
      'UPDATE chats SET category_id = ? WHERE project_id = ? AND favorite = 1 AND category_id IS NULL'
    );
    const tx = db.transaction(() => {
      for (const p of projects) {
        const existing = db.prepare(
          'SELECT id FROM chat_categories WHERE project_id = ? AND is_default = 1'
        ).get(p.id) as { id: string } | undefined;
        const catId = existing?.id ?? `${p.id}-favorites-${Math.random().toString(36).slice(2, 10)}`;
        if (!existing) insertCat.run(catId, p.id);
        updateChats.run(catId, p.id);
      }
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.favorites_to_categories_at', ?)"
      ).run(new Date().toISOString());
    });
    tx();
  }
} catch (err) {
  console.error('favorites→categories migration failed:', err);
}

// Add sort_order column to scripts (INTEGER). User-picked ordering per project;
// NULL rows fall back to created_at order after the explicitly ordered ones.
try {
  db.exec(`ALTER TABLE scripts ADD COLUMN sort_order INTEGER`);
} catch {
  // Column already exists — ignore
}

// Workspace mode (simple | dev). New rows default to 'simple'; existing rows
// are backfilled to 'dev' once on first boot (gated by a settings flag below).
try {
  db.exec(`ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'simple'`);
} catch {
  // Column already exists — ignore
}

// Workspace-level pinning (distinct from the per-chat `pinned` column on chats).
try {
  db.exec(`ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE projects ADD COLUMN pinned_at TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_pinned ON projects(pinned, pinned_at DESC)`);
} catch {
  // Already exists — ignore
}

// One-shot backfill: pre-existing workspaces keep the dev-mode UX they were
// built with. Gated by a settings flag so it runs at most once per database.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.mode_backfill_at'").get();
  if (!flag) {
    db.prepare("UPDATE projects SET mode = 'dev'").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.mode_backfill_at', ?)").run(new Date().toISOString());
  }
} catch {
  // settings table not ready or projects table missing mode column — skip.
}

// Chat artifacts (file/image references the agent surfaces in chat via display_artifact).
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_artifacts (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT,
    path TEXT NOT NULL,
    label TEXT,
    size INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_artifacts_chat ON chat_artifacts(chat_id, created_at);
`);

// --- Browser automation (Playwright) ---
// One persistent Chromium per workspace, one tab per chat. See plan:
// /Users/theodorosbarkas/.claude/plans/no-sequential-of-course-vectorized-abelson.md
db.exec(`
  CREATE TABLE IF NOT EXISTS browser_workspaces (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    cli_session_name TEXT NOT NULL,
    cdp_port INTEGER,
    pid INTEGER,
    user_data_dir TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_browser_tabs (
    chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tab_id TEXT NOT NULL,
    current_url TEXT,
    viewport_mode TEXT NOT NULL DEFAULT 'desktop',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_browser_tabs_project ON chat_browser_tabs(project_id);

  CREATE TABLE IF NOT EXISTS chat_browser_sessions (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT,
    label TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_chat_browser_sessions_chat ON chat_browser_sessions(chat_id, created_at);

  CREATE TABLE IF NOT EXISTS browser_takeover_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    takeover_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    raw TEXT,
    ts TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_browser_takeover_events_chat ON browser_takeover_events(chat_id, takeover_id);
`);


// --- Adapter settings (per-adapter key-value store) ---

db.exec(`
  CREATE TABLE IF NOT EXISTS adapter_settings (
    adapter_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (adapter_id, key)
  )
`);

// --- UI state (per user + project K/V; values are JSON strings) ---
// Used for VSCode-style workspace state: expanded folders in the file tree,
// open editors, scroll positions, etc. Generic K/V so new state types don't
// need migrations. user_id falls back to 'local' in single-user/desktop mode.
db.exec(`
  CREATE TABLE IF NOT EXISTS ui_state (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, project_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_ui_state_project ON ui_state(project_id);
`);

// One-shot: mirror claude-agent-sdk's enabled state to claw-chat for existing
// installs. They share authentication; the only delta is the artifacts tool.
// Without this, simple-mode chat creation would fail "adapter not enabled" for
// users with a pre-existing DB. Gated by a flag so it runs at most once.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.claw_chat_seed_at'").get();
  if (!flag) {
    const sdkEnabled = db.prepare(
      "SELECT value FROM adapter_settings WHERE adapter_id = 'claude-agent-sdk' AND key = 'enabled'"
    ).get() as { value: string } | undefined;
    if (sdkEnabled) {
      db.prepare(
        "INSERT OR REPLACE INTO adapter_settings (adapter_id, key, value) VALUES ('claw-chat', 'enabled', ?)"
      ).run(sdkEnabled.value);
    }
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.claw_chat_seed_at', ?)"
    ).run(new Date().toISOString());
  }
} catch (err) {
  console.error('claw-chat seed migration failed:', err);
}

// One-shot: existing chats inside simple-mode workspaces still carry the old
// 'claude-agent-sdk' adapter id (which doesn't load the display_artifact tool).
// Flip them to 'claw-chat' so the artifacts feature works without users having
// to recreate every chat. Dev workspaces are untouched. Gated by a flag.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.claw_chat_chat_backfill_at'").get();
  if (!flag) {
    db.prepare(`
      UPDATE chats
      SET adapter = 'claw-chat'
      WHERE adapter = 'claude-agent-sdk'
        AND project_id IN (SELECT id FROM projects WHERE mode = 'simple')
    `).run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.claw_chat_chat_backfill_at', ?)"
    ).run(new Date().toISOString());
  }
} catch (err) {
  console.error('claw-chat chat-backfill migration failed:', err);
}

// One-shot: claude-agent-sdk has been retired in favor of claw-chat (which is
// a functional superset — same SDK session manager, plus the display_artifact
// MCP tool). Flip every remaining reference: dev-mode chats, per-project
// default_adapter, and the global default_adapter setting. Gated by a flag.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.sdk_retire_at'").get();
  if (!flag) {
    db.prepare(`UPDATE chats SET adapter = 'claw-chat' WHERE adapter = 'claude-agent-sdk'`).run();
    db.prepare(`UPDATE projects SET default_adapter = 'claw-chat' WHERE default_adapter = 'claude-agent-sdk'`).run();
    db.prepare(`UPDATE settings SET value = 'claw-chat' WHERE key = 'default_adapter' AND value = 'claude-agent-sdk'`).run();
    db.prepare(`DELETE FROM adapter_settings WHERE adapter_id = 'claude-agent-sdk'`).run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.sdk_retire_at', ?)"
    ).run(new Date().toISOString());
  }
} catch (err) {
  console.error('claude-agent-sdk retirement migration failed:', err);
}

// === Sidebar tabs (browser/VSCode-style "open chats" model) =============
// chat is "in the sidebar" iff tab_opened_at IS NOT NULL.
// chat is "pinned to sidebar" (sticky tab) iff tab_pinned_at IS NOT NULL —
// pinned implies opened. Sort order within a project: pinned first
// (tab_pinned_at DESC), then unpinned tabs (tab_opened_at DESC). Closing a
// tab clears both columns; pinning sets both.
try {
  db.exec(`ALTER TABLE chats ADD COLUMN tab_opened_at TEXT`);
} catch {
  // Already exists — ignore
}
try {
  db.exec(`ALTER TABLE chats ADD COLUMN tab_pinned_at TEXT`);
} catch {
  // Already exists — ignore
}
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_tab_opened ON chats(project_id, tab_opened_at)`);
} catch {
  // Already exists — ignore
}

// One-shot backfill on first boot after this migration ships: open the top
// 5 most recent chats per project + every currently-unread chat. Without
// this, every user wakes up to an empty sidebar after the upgrade. Gated
// by a settings flag so it runs at most once per database.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.tabs_backfill_at'").get();
  if (!flag) {
    db.prepare(`
      UPDATE chats
      SET tab_opened_at = COALESCE(last_activity_at, created_at)
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY project_id
            ORDER BY COALESCE(last_activity_at, created_at) DESC
          ) AS rn
          FROM chats
        ) WHERE rn <= 5
      )
    `).run();
    db.prepare(`
      UPDATE chats
      SET tab_opened_at = COALESCE(last_activity_at, created_at)
      WHERE unread = 1 AND tab_opened_at IS NULL
    `).run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.tabs_backfill_at', ?)"
    ).run(new Date().toISOString());
  }
} catch (err) {
  console.error('tabs backfill migration failed:', err);
}

// User-controlled sidebar tab order. Lower values appear higher in the list.
// NULL means "no explicit order" — falls back to tab_opened_at as a tiebreaker.
// Pinned tabs sort independently above unpinned (separate ORDER BY priority).
try {
  db.exec(`ALTER TABLE chats ADD COLUMN tab_order INTEGER`);
} catch {
  // Already exists — ignore
}
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_tab_order ON chats(project_id, tab_order)`);
} catch {
  // Already exists — ignore
}

// One-shot backfill: assign tab_order to every currently-open tab so the
// existing visible order (tab_opened_at DESC) is preserved when we switch
// the ORDER BY to tab_order ASC. Gated by a settings flag.
try {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration.tab_order_backfill_at'").get();
  if (!flag) {
    db.prepare(`
      UPDATE chats
      SET tab_order = (
        SELECT rn FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY project_id
            ORDER BY tab_opened_at DESC
          ) AS rn
          FROM chats
          WHERE tab_opened_at IS NOT NULL
        ) AS ranks
        WHERE ranks.id = chats.id
      )
      WHERE tab_opened_at IS NOT NULL AND tab_order IS NULL
    `).run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration.tab_order_backfill_at', ?)"
    ).run(new Date().toISOString());
  }
} catch (err) {
  console.error('tab_order backfill migration failed:', err);
}

// Manual (user-owned) browser tabs — distinct from chat-bound tabs which are
// keyed in chat_browser_tabs by chat id. Manual tabs live under the project
// browser surface (popover) and are created / closed by the user directly.
db.exec(`
  CREATE TABLE IF NOT EXISTS manual_browser_tabs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT,
    current_url TEXT,
    viewport_mode TEXT NOT NULL DEFAULT 'desktop',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_manual_browser_tabs_project ON manual_browser_tabs(project_id, created_at);
`);

// Stale browser sessions cleanup — every active chat_browser_sessions row
// references a Chromium that died with the server. On boot, mark them
// closed so old artifact strips don't appear in chats whose underlying
// browser is gone.
try {
  db.prepare(
    "UPDATE chat_browser_sessions SET status = 'closed', closed_at = ? WHERE status = 'active'"
  ).run(new Date().toISOString());
} catch {
  // Table didn't exist on first boot — fine.
}

// Per-chat armed tools — JSON array of tool ids the user has armed for this
// chat (e.g. ["browser"]). NULL / "[]" = no tools armed. Drives whether MCP
// servers + system-prompt blocks for those tools mount when the SDK session
// starts. See browser-tools-ux-spec.md.
try {
  db.exec(`ALTER TABLE chats ADD COLUMN armed_tools TEXT NOT NULL DEFAULT '[]'`);
} catch {
  // Column already exists — ignore
}

export function getAdapterSetting(adapterId: string, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM adapter_settings WHERE adapter_id = ? AND key = ?').get(adapterId, key) as { value: string } | undefined;
  return row?.value;
}

export function setAdapterSetting(adapterId: string, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO adapter_settings (adapter_id, key, value) VALUES (?, ?, ?)').run(adapterId, key, value);
}

export function deleteAdapterSetting(adapterId: string, key: string): void {
  db.prepare('DELETE FROM adapter_settings WHERE adapter_id = ? AND key = ?').run(adapterId, key);
}

export function getAdapterSettings(adapterId: string): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM adapter_settings WHERE adapter_id = ?').all(adapterId) as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function getAllAdapterSettings(): Record<string, Record<string, string>> {
  const rows = db.prepare('SELECT adapter_id, key, value FROM adapter_settings').all() as Array<{ adapter_id: string; key: string; value: string }>;
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    if (!result[row.adapter_id]) result[row.adapter_id] = {};
    result[row.adapter_id][row.key] = row.value;
  }
  return result;
}

export function isAdapterEnabled(adapterId: string): boolean {
  return getAdapterSetting(adapterId, 'enabled') === 'true';
}

export function getEnabledAdapterIds(): string[] {
  const rows = db.prepare("SELECT adapter_id FROM adapter_settings WHERE key = 'enabled' AND value = 'true'").all() as Array<{ adapter_id: string }>;
  return rows.map(r => r.adapter_id);
}

export function hasAnyAdapterSettings(): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM adapter_settings').get() as { count: number };
  return row.count > 0;
}

// --- Per-adapter model preferences ---
// Stored under reserved keys in the adapter_settings K/V table:
//   key='default_model'   value=<model id string>
//   key='favorite_models' value=<JSON array of model id strings>
// The configure dialog is the only UI that mutates these; chat creation
// reads default_model to seed chat.model.

export function getDefaultModel(adapterId: string): string | null {
  return getAdapterSetting(adapterId, 'default_model') ?? null;
}

export function setDefaultModel(adapterId: string, modelId: string | null): void {
  if (modelId === null || modelId === '') {
    deleteAdapterSetting(adapterId, 'default_model');
  } else {
    setAdapterSetting(adapterId, 'default_model', modelId);
  }
}

export function getFavoriteModels(adapterId: string): string[] {
  const raw = getAdapterSetting(adapterId, 'favorite_models');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setFavoriteModels(adapterId: string, modelIds: string[]): void {
  setAdapterSetting(adapterId, 'favorite_models', JSON.stringify(modelIds));
}

// --- UI state helpers (per user + project) ---
export function getUiState(userId: string, projectId: string, key: string): string | null {
  const row = db.prepare(
    'SELECT value FROM ui_state WHERE user_id = ? AND project_id = ? AND key = ?'
  ).get(userId, projectId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUiState(userId: string, projectId: string, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ui_state (user_id, project_id, key, value, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, project_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `).run(userId, projectId, key, value);
}

export function deleteUiState(userId: string, projectId: string, key: string): void {
  db.prepare(
    'DELETE FROM ui_state WHERE user_id = ? AND project_id = ? AND key = ?'
  ).run(userId, projectId, key);
}

// --- Session purge ---
export function purgeExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expired < datetime('now')").run();
}

// --- Tunnel credential persistence (local mode only) ---
export interface TunnelCredentials {
  apiKey: string;
  userSubdomain: string;
  userId?: string;
  email?: string;
  username?: string;
  plan?: string;
}

export function saveTunnelCredentials(creds: {
  apiKey: string;
  userSubdomain: string;
  userId?: string;
  email?: string;
  username?: string;
  plan?: string;
}): void {
  db.prepare(`
    INSERT INTO tunnel_credentials (id, api_key, user_subdomain, user_id, email, username, plan, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      api_key = excluded.api_key,
      user_subdomain = excluded.user_subdomain,
      user_id = COALESCE(excluded.user_id, tunnel_credentials.user_id),
      email = COALESCE(excluded.email, tunnel_credentials.email),
      username = COALESCE(excluded.username, tunnel_credentials.username),
      plan = COALESCE(excluded.plan, tunnel_credentials.plan),
      updated_at = datetime('now')
  `).run(
    creds.apiKey,
    creds.userSubdomain,
    creds.userId || null,
    creds.email || null,
    creds.username || null,
    creds.plan || 'free',
  );
}

export function getTunnelCredentials(): TunnelCredentials | null {
  const row = db.prepare('SELECT * FROM tunnel_credentials WHERE id = 1').get() as any;
  if (!row) return null;
  return {
    apiKey: row.api_key,
    userSubdomain: row.user_subdomain,
    userId: row.user_id || undefined,
    email: row.email || undefined,
    username: row.username || undefined,
    plan: row.plan || undefined,
  };
}

export function deleteTunnelCredentials(): void {
  db.prepare('DELETE FROM tunnel_credentials WHERE id = 1').run();
}

// --- Settings helpers ---
export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getOrCreateSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const existing = getSetting('session_secret');
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', secret);
  return secret;
}

// --- Global default adapter (user-level preference) ---
// Stored in the `settings` table under key `default_adapter`. Resolved to an
// effective value by preferring the stored choice if it's still enabled, then
// falling back to the first enabled adapter, then to `claude-code`.
export const DEFAULT_ADAPTER_FALLBACK = 'claude-code';

export function getStoredDefaultAdapter(): string | null {
  return getSetting('default_adapter') ?? null;
}

export function setStoredDefaultAdapter(adapterId: string): void {
  setSetting('default_adapter', adapterId);
}

export function resolveDefaultAdapter(): string {
  const stored = getStoredDefaultAdapter();
  const enabled = getEnabledAdapterIds();
  if (stored && enabled.includes(stored)) return stored;
  if (enabled.length > 0) {
    return enabled.includes(DEFAULT_ADAPTER_FALLBACK) ? DEFAULT_ADAPTER_FALLBACK : enabled[0];
  }
  return stored || DEFAULT_ADAPTER_FALLBACK;
}

export default db;
