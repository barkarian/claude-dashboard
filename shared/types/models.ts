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
  /**
   * Adapter-opaque model identifier (e.g. "claude-sonnet-4-6" for claw-chat,
   * "anthropic/claude-sonnet-4-6" for opencode). NULL means the runtime
   * falls back to the adapter's `default_model` setting at session start.
   * Set at chat creation, mutable via the chat-header model picker.
   */
  model: string | null;
  ccConversationId: string | null;
  sessionId: string | null;
  draftMessage: string | null;
  stashedInput: string | null;
  unread: boolean;
  categoryId: string | null;
  category: ChatCategory | null;
  /** When the chat was last opened as a sidebar tab. NULL = closed (not in
   *  the sidebar's chat list — still findable via the chat list view). */
  tabOpenedAt: string | null;
  /** When the tab was pinned (sticky in the sidebar). NULL = unpinned.
   *  Pinned implies opened. */
  tabPinnedAt: string | null;
  /** User-controlled sidebar position. Lower values appear higher in the
   *  list. NULL = no explicit order (falls back to tabOpenedAt). The
   *  sidebar is sorted by this value, never by activity, so the order
   *  doesn't shuffle on every new message. */
  tabOrder: number | null;
  /** Tool ids the user has armed for this chat. Drives which MCP servers +
   *  system-prompt blocks load when the SDK session starts. Empty = no
   *  optional tools. See browser-tools-ux-spec.md. */
  armedTools: string[];
}

export type ToolId = 'browser';

export interface ToolDescriptor {
  id: ToolId;
  name: string;
  description: string;
  /** Lucide icon name or emoji used in the chip. */
  icon: string;
  /** Whether this tool requires a one-time install before first use. */
  installable: boolean;
}

export interface ToolInstallProgress {
  toolId: ToolId;
  /** 0-100, or null when in indeterminate / pre-progress states. */
  percent: number | null;
  status: 'starting' | 'downloading' | 'installing' | 'ready' | 'failed';
  message?: string;
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

export type BrowserViewportMode = 'desktop' | 'tablet' | 'mobile';

/** Unified browser tab descriptor — covers chat-bound and manual tabs both.
 *  Chat tabs use the chatId as the tabId; manual tabs use a `manual_<uuid>`. */
export interface BrowserTabDescriptor {
  tabId: string;
  projectId: string;
  /** 'chat' if the tab is owned by a chat; 'manual' if user-created. */
  kind: 'chat' | 'manual';
  /** The owning chat id when kind === 'chat'. */
  chatId?: string;
  /** User-set or chat-derived label shown in the popover. */
  label: string;
  /** Current URL of the tab (best-effort, last-known). */
  currentUrl: string | null;
  viewportMode: BrowserViewportMode;
  /** True if a screencast frame arrived in the last 1.5s. */
  driving: boolean;
  /** Whether the underlying Page is still alive. */
  alive: boolean;
}

export interface ChatBrowserTab {
  chatId: string;
  projectId: string;
  tabId: string;
  currentUrl: string | null;
  viewportMode: BrowserViewportMode;
  createdAt: string;
}

export interface ChatBrowserSession {
  id: string;
  chatId: string;
  messageId: string | null;
  label: string | null;
  status: 'active' | 'closed';
  createdAt: string;
  closedAt: string | null;
}

export interface BrowserTakeoverEvent {
  id: number;
  chatId: string;
  takeoverId: string;
  eventType: string;
  description: string;
  raw: string | null;
  ts: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  repo: string | null;
  createdAt: string;
  scriptsCount: number;
  chatsCount: number;
  /** How many chats are currently sidebar tabs (open or pinned). Used by
   *  the sidebar to bubble projects with active tabs to the top of Recents
   *  and to auto-expand them. */
  openTabsCount: number;
  mode: ProjectMode;
  pinned: boolean;
  pinnedAt: string | null;
  /** Most recent chat activity, falling back to createdAt if no chats. */
  lastActivityAt: string;
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
