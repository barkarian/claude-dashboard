// === Core Data Models ===

/**
 * Chat adapter identifier. Open string type so new adapters can be registered
 * without modifying this file. Known built-in values:
 * - 'claude-code' — Claude Code terminal (PTY + JSONL watcher)
 * - 'claw-chat'   — message-based chat (Agent SDK + display_artifact tool)
 */
export type ChatAdapter = string;

/**
 * Workspace mode controls visible UI surfaces.
 * - 'simple' — consumer surface: Chats + Files tabs, claw-chat only,
 *              no path breadcrumb, no context-window % indicator.
 * - 'dev'    — power surface: Scripts tab visible, all adapters available.
 */
export type ProjectMode = 'simple' | 'dev';

export interface Script {
  id: string;
  label: string;
  command: string;
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: unknown;
  timestamp?: string;
  id?: string;
}

export interface ChatCategory {
  id: string;
  projectId: string;
  name: string;
  emoji: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Chat {
  id: string;
  label: string;
  description: string | null;
  createdAt: string;
  lastActivityAt: string;
  history: ChatHistoryEntry[];
  sdkSessionId: string | null;
  adapter: ChatAdapter;
  ccConversationId: string | null;
  sessionId: string | null;
  draftMessage: string | null;
  stashedInput: string | null;
  unread: boolean;
  categoryId: string | null;
  category: ChatCategory | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  repo: string | null;
  createdAt: string;
  shellOverride: string | null;
  defaultAdapter: ChatAdapter;
  /** Ordered list of adapter IDs for the project. Index 0 is the default. */
  adapterOrder: ChatAdapter[] | null;
  aiNamingEnabled: 'none' | 'on';
  mode: ProjectMode;
  pinned: boolean;
  pinnedAt: string | null;
  scripts: Script[];
  chats: Chat[];
  categories: ChatCategory[];
}

/**
 * Chat artifact — a file or image the agent surfaces inline via the
 * `display_artifact` tool in the claw-chat adapter. Stored separately from
 * messages so they survive partial-message rebuilds and chat reloads.
 */
export interface ChatArtifact {
  id: string;
  chatId: string;
  messageId: string | null;
  path: string;
  label: string | null;
  size: number | null;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  repo: string | null;
  createdAt: string;
  scriptsCount: number;
  chatsCount: number;
  mode: ProjectMode;
  pinned: boolean;
  pinnedAt: string | null;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  updatedAt: string;
  private: boolean;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
}

export interface DiffResult {
  files: DiffFile[];
  rawDiff: string;
}

export type ProcessStatus = 'running' | 'exited' | 'stopped';

export interface ScriptWithStatus extends Script {
  status: ProcessStatus;
}

export interface RunningProcess {
  scriptId: string;
  command: string;
  status: ProcessStatus;
  startedAt: string;
  exitCode: number | null;
  label?: string;
  isShell?: boolean;
  detectedPorts?: number[];
  tunnelUrls?: Record<number, string>;
  source?: 'script' | 'shell' | 'claude-code';
  chatId?: string;
}

// === Git Models ===

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  remotes: GitRemote[];
  log: GitLogEntry[];
  unpushedCount: number;
  hasGithubToken: boolean;
}

export interface BranchList {
  current: string | null;
  local: string[];
  remote: string[];
}

export interface RepoInfo {
  repoPath: string;
  name: string;
  changeCount: number;
}

// === Saved Recordings ===

export interface SavedRecordingScript {
  scriptId: string;
  label: string;
  command: string;
}

export interface SavedRecording {
  id: string;
  projectId: string;
  scripts: SavedRecordingScript[];
  lines: string[];
  browserLines: string[];
  lineCount: number;
  browserLineCount: number;
  durationSecs: number | null;
  startedAt: string;
  stoppedAt: string | null;
  createdAt: string;
}
