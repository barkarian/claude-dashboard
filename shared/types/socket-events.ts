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
