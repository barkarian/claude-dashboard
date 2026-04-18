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
    autostart INTEGER NOT NULL DEFAULT 0,
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
// Add shell_override column to projects (safe to re-run)
try {
  db.exec(`ALTER TABLE projects ADD COLUMN shell_override TEXT`);
} catch {
  // Column already exists — ignore
}

// Add default_adapter column to projects
try {
  db.exec(`ALTER TABLE projects ADD COLUMN default_adapter TEXT DEFAULT 'claude-agent-sdk'`);
} catch {
  // Column already exists — ignore
}

// Add adapter column to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN adapter TEXT DEFAULT 'claude-agent-sdk'`);
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

// --- Adapter settings (per-adapter key-value store) ---

db.exec(`
  CREATE TABLE IF NOT EXISTS adapter_settings (
    adapter_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (adapter_id, key)
  )
`);

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

export default db;
