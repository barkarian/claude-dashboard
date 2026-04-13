// === Core Data Models ===

/**
 * Chat adapter identifier. Open string type so new adapters can be registered
 * without modifying this file. Known built-in values:
 * - 'claude-code'      — Claude Code terminal (PTY + JSONL watcher)
 * - 'claude-agent-sdk' — Claude Agent SDK (message-based API)
 */
export type ChatAdapter = string;

export interface Script {
  id: string;
  label: string;
  command: string;
  autostart: boolean;
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: unknown;
  timestamp?: string;
  id?: string;
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
}

export interface Project {
  id: string;
  name: string;
  path: string;
  repo: string | null;
  createdAt: string;
  shellOverride: string | null;
  defaultAdapter: ChatAdapter;
  aiNamingEnabled: 'none' | 'on';
  scripts: Script[];
  chats: Chat[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  repo: string | null;
  createdAt: string;
  scriptsCount: number;
  chatsCount: number;
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
