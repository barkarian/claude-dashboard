import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SessionStateContext, UnifiedStatus, QuestionPayload, PlanPayload, ToolPermissionPayload } from '../../shared/types/session.ts';
import type { SDKChatMessage, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock } from '../../shared/types/sdk.ts';

const DEBOUNCE_MS = 150;
const TAIL_BYTES = 64 * 1024; // Read last 64KB of JSONL

// Tools that are auto-approved (never trigger permission-awaiting)
const AUTO_APPROVED_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'TaskOutput', 'TodoWrite', 'EnterPlanMode', 'ToolSearch', 'LSP',
  'Agent', 'TaskStop', 'NotebookEdit',
]);

interface WatchedSession {
  sessionId: string;
  projectPath: string;
  filePath: string;
  watcher: fs.FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  state: SessionStateContext;
}

/**
 * Encode a project path to match Claude Code's directory naming.
 * `/Users/foo/bar` → `-Users-foo-bar`
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

/**
 * Get the JSONL file path for a session.
 */
function getJsonlPath(sessionId: string, projectPath: string): string {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(projectPath));
  return path.join(claudeDir, `${sessionId}.jsonl`);
}

/**
 * Read the tail of a file (last N bytes) and return complete lines.
 */
function readTail(filePath: string, bytes: number): string[] {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return [];

    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(bytes, stat.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);

    const text = buf.toString('utf-8');
    const lines = text.split('\n').filter(Boolean);

    // If we started mid-file, the first line may be truncated — skip it
    if (start > 0 && lines.length > 0) {
      lines.shift();
    }

    return lines;
  } catch {
    return [];
  }
}

/**
 * Parse a JSONL line safely.
 */
function parseLine(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Extract the last assistant and user entries from JSONL lines.
 */
function findLastEntries(lines: string[]): { lastAssistant: any | null; lastUser: any | null } {
  let lastAssistant: any | null = null;
  let lastUser: any | null = null;

  // Parse from the end for efficiency
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]);
    if (!entry) continue;

    if (entry.type === 'assistant' && !lastAssistant) {
      lastAssistant = entry;
    } else if (entry.type === 'user' && entry.message && !lastUser) {
      lastUser = entry;
    }

    // Found both — stop scanning
    if (lastAssistant && lastUser) break;
  }

  return { lastAssistant, lastUser };
}

/**
 * Check if the last tool_use has a matching tool_result in a subsequent user entry.
 * This indicates the tool was auto-approved.
 */
function hasMatchingToolResult(lines: string[], toolUseId: string, assistantIndex: number): boolean {
  for (let i = assistantIndex + 1; i < lines.length; i++) {
    const entry = parseLine(lines[i]);
    if (!entry) continue;

    // Look in user entries for tool_result
    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
            return true;
          }
        }
      }
    }

    // If we hit another assistant entry, stop looking
    if (entry.type === 'assistant') break;
  }
  return false;
}

/**
 * Derive SessionStateContext from JSONL tail content.
 */
function deriveState(lines: string[]): SessionStateContext {
  const { lastAssistant, lastUser } = findLastEntries(lines);

  // Check for interruption in last user entry
  if (lastUser?.message) {
    const content = lastUser.message.content;
    const interruptText = '[Request interrupted by user]';
    if (typeof content === 'string' && content.includes(interruptText)) {
      return { status: 'interrupted', lastEntryTimestamp: parseTimestamp(lastUser) };
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.includes(interruptText)) {
          return { status: 'interrupted', lastEntryTimestamp: parseTimestamp(lastUser) };
        }
      }
    }
  }

  // No assistant entry yet → idle (fresh session)
  if (!lastAssistant?.message) {
    return { status: 'idle' };
  }

  const msg = lastAssistant.message;
  const stopReason = msg.stop_reason;
  const content: any[] = Array.isArray(msg.content) ? msg.content : [];
  const timestamp = parseTimestamp(lastAssistant);

  if (stopReason === 'end_turn') {
    // Extract last text preview
    const lastText = [...content].reverse().find((b: any) => b.type === 'text');
    const preview = lastText?.text?.slice(0, 100);
    return { status: 'idle', lastTextPreview: preview, lastEntryTimestamp: timestamp };
  }

  if (stopReason === 'tool_use') {
    // Find the last tool_use block
    const lastToolUse = [...content].reverse().find((b: any) => b.type === 'tool_use');
    if (!lastToolUse) {
      return { status: 'working', lastEntryTimestamp: timestamp };
    }

    const toolName: string = lastToolUse.name || '';
    const toolInput: Record<string, unknown> = lastToolUse.input || {};
    const toolId: string = lastToolUse.id || '';

    // AskUserQuestion → question-awaiting
    if (toolName === 'AskUserQuestion') {
      const questions = (toolInput.questions as any[]) || [];
      const questionPayloads: QuestionPayload[] = questions.map((q: any) => ({
        question: q.question || '',
        header: q.header || '',
        options: (q.options || []).map((o: any) => ({
          label: o.label || '',
          description: o.description || '',
        })),
        multiSelect: q.multiSelect || false,
      }));

      return {
        status: questions.length > 1 ? 'questions-awaiting' : 'question-awaiting',
        questions: questionPayloads,
        lastEntryTimestamp: timestamp,
      };
    }

    // ExitPlanMode → plan-awaiting
    if (toolName === 'ExitPlanMode') {
      const plan: PlanPayload = {
        plan: (toolInput.plan as string) || '',
        planFilePath: (toolInput.planFilePath as string) || '',
        allowedPrompts: Array.isArray(toolInput.allowedPrompts)
          ? (toolInput.allowedPrompts as any[]).map((p: any) => ({
              tool: p.tool || '',
              prompt: p.prompt || '',
            }))
          : [],
      };
      return { status: 'plan-awaiting', plan, lastEntryTimestamp: timestamp };
    }

    // EnterPlanMode → still working (exploring plan mode)
    if (toolName === 'EnterPlanMode') {
      return { status: 'working', lastEntryTimestamp: timestamp };
    }

    // Auto-approved tools → check for matching tool_result
    if (AUTO_APPROVED_TOOLS.has(toolName)) {
      // Find the index of the last assistant entry to check for tool_result after it
      const assistantIndex = findAssistantIndex(lines, lastAssistant);
      if (assistantIndex >= 0 && hasMatchingToolResult(lines, toolId, assistantIndex)) {
        return { status: 'working', lastEntryTimestamp: timestamp };
      }
      // No result yet but it's an auto-approved tool → still working
      return { status: 'working', lastEntryTimestamp: timestamp };
    }

    // Other tools → permission-awaiting
    const description = buildToolDescription(toolName, toolInput);
    const pendingTool: ToolPermissionPayload = {
      toolName,
      toolInput,
      description,
    };
    return { status: 'permission-awaiting', pendingTool, lastEntryTimestamp: timestamp };
  }

  // null/undefined stop_reason → still streaming
  if (!stopReason) {
    return { status: 'working', lastEntryTimestamp: timestamp };
  }

  return { status: 'working', lastEntryTimestamp: timestamp };
}

function parseTimestamp(entry: any): number | undefined {
  if (entry?.timestamp) {
    const t = new Date(entry.timestamp).getTime();
    return isNaN(t) ? undefined : t;
  }
  return undefined;
}

function findAssistantIndex(lines: string[], target: any): number {
  const targetUuid = target?.uuid;
  if (!targetUuid) return -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]);
    if (entry?.uuid === targetUuid) return i;
  }
  return -1;
}

function buildToolDescription(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' && toolInput.command) {
    return `Run command: ${toolInput.command}`;
  }
  if (toolName === 'Write' && toolInput.file_path) {
    return `Write file: ${toolInput.file_path}`;
  }
  if (toolName === 'Edit' && toolInput.file_path) {
    return `Edit file: ${toolInput.file_path}`;
  }
  return `Claude wants to use: ${toolName}`;
}

/**
 * Watches JSONL session files and derives SessionStateContext from their content.
 * Emits 'state-change' events when the state changes.
 */
export class JsonlWatcher extends EventEmitter {
  private sessions = new Map<string, WatchedSession>();

  watchSession(sessionId: string, projectPath: string): void {
    // Already watching this session
    if (this.sessions.has(sessionId)) return;

    const filePath = getJsonlPath(sessionId, projectPath);
    const initialState: SessionStateContext = { status: 'starting' };

    const watched: WatchedSession = {
      sessionId,
      projectPath,
      filePath,
      watcher: null,
      debounceTimer: null,
      state: initialState,
    };

    this.sessions.set(sessionId, watched);

    // Do an initial read if the file already exists
    if (fs.existsSync(filePath)) {
      this.processFile(watched);
    }

    // Start watching. The file might not exist yet, so watch the directory.
    this.startWatching(watched);
  }

  unwatchSession(sessionId: string): void {
    const watched = this.sessions.get(sessionId);
    if (!watched) return;

    if (watched.watcher) {
      watched.watcher.close();
      watched.watcher = null;
    }
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer);
    }

    this.sessions.delete(sessionId);
  }

  getState(sessionId: string): SessionStateContext | null {
    return this.sessions.get(sessionId)?.state || null;
  }

  private startWatching(watched: WatchedSession): void {
    const dir = path.dirname(watched.filePath);
    const filename = path.basename(watched.filePath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      watched.watcher = fs.watch(dir, (eventType, changedFile) => {
        if (changedFile === filename) {
          this.scheduleProcess(watched);
        }
      });

      watched.watcher.on('error', () => {
        // Silently handle watch errors — file may not exist yet
      });
    } catch {
      // Directory watching failed — will retry on next watchSession call
    }
  }

  private scheduleProcess(watched: WatchedSession): void {
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer);
    }
    watched.debounceTimer = setTimeout(() => {
      watched.debounceTimer = null;
      this.processFile(watched);
    }, DEBOUNCE_MS);
  }

  private processFile(watched: WatchedSession): void {
    const lines = readTail(watched.filePath, TAIL_BYTES);
    if (lines.length === 0) return;

    const newState = deriveState(lines);
    const prevState = watched.state;

    // Only emit if status or key context changed
    if (
      newState.status !== prevState.status ||
      newState.lastTextPreview !== prevState.lastTextPreview ||
      newState.lastEntryTimestamp !== prevState.lastEntryTimestamp
    ) {
      watched.state = newState;
      this.emit('state-change', watched.sessionId, newState, prevState);
    }
  }

  /**
   * Clean up all watchers on shutdown.
   */
  dispose(): void {
    for (const [sessionId] of this.sessions) {
      this.unwatchSession(sessionId);
    }
  }
}

/**
 * Read a session's JSONL file and return the conversation as SDKChatMessage[].
 * This is the single source of truth for all chat history — both CC and SDK
 * write to the same JSONL files.
 */
export function readSessionHistory(sessionId: string, projectPath: string): SDKChatMessage[] {
  const filePath = getJsonlPath(sessionId, projectPath);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const messages: SDKChatMessage[] = [];
  const lines = raw.split('\n').filter(Boolean);

  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry?.message) continue;

    const msg = entry.message;
    const role = msg.role as 'user' | 'assistant' | undefined;
    if (!role) continue;

    // Skip interrupt markers and tool_result-only user messages
    if (entry.type === 'user') {
      const content = msg.content;

      // String content = user prompt
      if (typeof content === 'string') {
        // Skip "[Request interrupted by user]"
        if (content.includes('[Request interrupted by user]')) continue;

        messages.push({
          id: entry.uuid || `user-${entry.timestamp}`,
          role: 'user',
          content: [{ type: 'text', text: content } as TextBlock],
          timestamp: entry.timestamp,
        });
        continue;
      }

      // Array content
      if (Array.isArray(content)) {
        // Check if it's an interrupt
        const isInterrupt = content.some(
          (b: any) => b.type === 'text' && typeof b.text === 'string' && b.text.includes('[Request interrupted by user]')
        );
        if (isInterrupt) continue;

        // Check if it's a tool_result (auto-generated, not user-typed)
        const hasToolResult = content.some((b: any) => b.type === 'tool_result');
        const hasUserText = content.some((b: any) => b.type === 'text' && b.text && !b.text.includes('[Request interrupted'));
        if (hasToolResult && !hasUserText) {
          // Append tool results to the last assistant message for display
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.role === 'assistant') {
            for (const block of content) {
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c.text || '').join('\n')
                    : '';
                lastMsg.content.push({
                  type: 'tool_result',
                  tool_use_id: block.tool_use_id || '',
                  content: resultContent,
                  is_error: block.is_error || false,
                } as ToolResultBlock);
              }
            }
          }
          continue;
        }

        // Regular user message with text blocks
        const blocks: ContentBlock[] = [];
        for (const block of content) {
          if (block.type === 'text') {
            blocks.push({ type: 'text', text: block.text || '' } as TextBlock);
          }
        }
        if (blocks.length > 0) {
          messages.push({
            id: entry.uuid || `user-${entry.timestamp}`,
            role: 'user',
            content: blocks,
            timestamp: entry.timestamp,
          });
        }
        continue;
      }
    }

    if (entry.type === 'assistant') {
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      // Skip partial/streaming entries (no stop_reason)
      if (!msg.stop_reason) continue;

      const blocks: ContentBlock[] = [];
      for (const block of content) {
        switch (block.type) {
          case 'text':
            blocks.push({ type: 'text', text: block.text || '' } as TextBlock);
            break;
          case 'tool_use':
            blocks.push({
              type: 'tool_use',
              id: block.id || '',
              name: block.name || '',
              input: block.input || {},
            } as ToolUseBlock);
            break;
          case 'thinking':
            blocks.push({ type: 'thinking', thinking: block.thinking || '' } as ThinkingBlock);
            break;
        }
      }

      if (blocks.length > 0) {
        messages.push({
          id: entry.uuid || `assistant-${entry.timestamp}`,
          role: 'assistant',
          content: blocks,
          timestamp: entry.timestamp,
        });
      }
    }
  }

  return messages;
}

// Singleton instance
const jsonlWatcher = new JsonlWatcher();
export default jsonlWatcher;
