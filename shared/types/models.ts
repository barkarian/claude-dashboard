// === Core Data Models ===

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
  createdAt: string;
  history: ChatHistoryEntry[];
  sdkSessionId: string | null;
}

export interface Project {
  id: string;
  name: string;
  repo: string | null;
  createdAt: string;
  scripts: Script[];
  chats: Chat[];
}

export interface ProjectSummary {
  id: string;
  name: string;
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
