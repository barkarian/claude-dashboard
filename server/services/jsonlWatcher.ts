import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { watch, type FSWatcher } from 'chokidar';
import type { SessionStateContext, UnifiedStatus, QuestionPayload, PlanPayload, ToolPermissionPayload } from '../../shared/types/session.ts';
import type { SDKChatMessage, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock } from '../../shared/types/sdk.ts';

// --- Constants ---

const DEBOUNCE_MS = 200;
const STALE_TIMEOUT_MS = 15_000;
const STALE_CHECK_INTERVAL_MS = 10_000;
const SIGNALS_DIR = path.join(os.homedir(), '.claude', 'session-signals');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Tools that are auto-approved (never trigger permission-awaiting)
const AUTO_APPROVED_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'TaskOutput', 'TodoWrite', 'EnterPlanMode', 'ToolSearch', 'LSP',
  'Agent', 'TaskStop', 'NotebookEdit',
]);

// --- Types ---

interface ParsedEntry {
  type: string;
  message?: any;
  timestamp?: string;
  uuid?: string;
  subtype?: string;
  [key: string]: any;
}

interface TailResult {
  entries: ParsedEntry[];
  newPosition: number;
  hadPartialLine: boolean;
}

// State machine types
type MachineState = 'working' | 'waiting_for_approval' | 'waiting_for_input';

type MachineEvent =
  | { type: 'USER_PROMPT'; timestamp: number; entry: ParsedEntry }
  | { type: 'TOOL_RESULT'; timestamp: number; toolUseIds: string[] }
  | { type: 'ASSISTANT_STREAMING'; timestamp: number; entry: ParsedEntry }
  | { type: 'ASSISTANT_TOOL_USE'; timestamp: number; toolUseIds: string[]; entry: ParsedEntry }
  | { type: 'BACKGROUND_TASK_START'; timestamp: number; toolUseId: string }
  | { type: 'BACKGROUND_TASK_COMPLETE'; timestamp: number; toolUseId: string }
  | { type: 'TURN_END'; timestamp: number }
  | { type: 'INTERRUPTED'; timestamp: number };

interface MachineContext {
  state: MachineState;
  lastActivityAt: number;
  pendingToolIds: string[];
  lastAssistantEntry: ParsedEntry | null;
  /** tool_use_ids of Bash commands started with run_in_background: true */
  activeBackgroundTaskIds: Set<string>;
}

// Signal types
interface PendingPermission {
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  pending_since: string;
}

interface WatchedSession {
  sessionId: string;
  projectPath: string;
  filePath: string;
  state: SessionStateContext;
  bytePosition: number;
  entries: ParsedEntry[];
}

// --- Path helpers ---

function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

function getJsonlPath(sessionId: string, projectPath: string): string {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(projectPath));
  return path.join(claudeDir, `${sessionId}.jsonl`);
}

// --- Incremental JSONL reading ---

function parseLine(line: string): ParsedEntry | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Incrementally read new JSONL entries from a file starting at a byte offset.
 * Handles partial lines at EOF safely.
 */
function tailRead(filePath: string, fromByte: number): TailResult {
  try {
    const stat = fs.statSync(filePath);
    if (fromByte >= stat.size) {
      return { entries: [], newPosition: fromByte, hadPartialLine: false };
    }

    const fd = fs.openSync(filePath, 'r');
    const readSize = stat.size - fromByte;
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, fromByte);
    fs.closeSync(fd);

    const content = buf.toString('utf-8');
    const lines = content.split('\n');

    const entries: ParsedEntry[] = [];
    let bytesConsumed = 0;
    let hadPartialLine = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLastLine = i === lines.length - 1;
      const lineBytes = Buffer.byteLength(line, 'utf-8');

      // Last line might be partial if file doesn't end with newline
      if (isLastLine && !content.endsWith('\n') && line.length > 0) {
        hadPartialLine = true;
        break;
      }

      // Skip empty lines
      if (!line.trim()) {
        bytesConsumed += lineBytes + (isLastLine ? 0 : 1);
        continue;
      }

      // Skip lines that don't look like JSON objects
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) {
        bytesConsumed += lineBytes + 1;
        continue;
      }

      const entry = parseLine(line);
      if (entry) {
        entries.push(entry);
      }
      bytesConsumed += lineBytes + 1;
    }

    return {
      entries,
      newPosition: fromByte + bytesConsumed,
      hadPartialLine,
    };
  } catch {
    return { entries: [], newPosition: fromByte, hadPartialLine: false };
  }
}

// --- State machine ---

function parseTimestamp(entry: ParsedEntry): number {
  if (entry?.timestamp) {
    const t = new Date(entry.timestamp).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

/**
 * Convert a parsed JSONL entry into state machine event(s).
 * Returns an array because a single entry can produce multiple events
 * (e.g. an assistant message with both a normal tool_use and a background Bash).
 */
function entryToEvents(entry: ParsedEntry): MachineEvent[] {
  const events: MachineEvent[] = [];

  if (entry.type === 'user' && entry.message) {
    const content = entry.message.content;
    const ts = parseTimestamp(entry);

    // Check for interruption
    const interruptText = '[Request interrupted by user]';
    if (typeof content === 'string' && content.includes(interruptText)) {
      return [{ type: 'INTERRUPTED', timestamp: ts }];
    }
    if (Array.isArray(content)) {
      const isInterrupt = content.some(
        (b: any) => b.type === 'text' && typeof b.text === 'string' && b.text.includes(interruptText)
      );
      if (isInterrupt) {
        return [{ type: 'INTERRUPTED', timestamp: ts }];
      }

      // Check for tool results
      const toolUseIds = content
        .filter((b: any) => b.type === 'tool_result')
        .map((b: any) => b.tool_use_id as string);
      if (toolUseIds.length > 0) {
        return [{ type: 'TOOL_RESULT', timestamp: ts, toolUseIds }];
      }

      // User prompt in array form (with text blocks)
      const hasTextBlock = content.some((b: any) => b.type === 'text');
      if (hasTextBlock) {
        return [{ type: 'USER_PROMPT', timestamp: ts, entry }];
      }
    }

    // String content = user prompt
    if (typeof content === 'string') {
      return [{ type: 'USER_PROMPT', timestamp: ts, entry }];
    }
  }

  if (entry.type === 'assistant' && entry.message) {
    const content = entry.message.content;
    const ts = parseTimestamp(entry);

    if (Array.isArray(content)) {
      // Detect Bash calls with run_in_background: true
      for (const block of content) {
        if (block.type === 'tool_use' && block.name === 'Bash' && block.input?.run_in_background === true) {
          events.push({ type: 'BACKGROUND_TASK_START', timestamp: ts, toolUseId: block.id });
        }
      }

      // Find non-auto-approved tool_use blocks
      const toolUseBlocks = content.filter(
        (b: any) => b.type === 'tool_use' && !AUTO_APPROVED_TOOLS.has(b.name)
      );
      if (toolUseBlocks.length > 0) {
        const toolUseIds = toolUseBlocks.map((b: any) => b.id as string);
        events.push({ type: 'ASSISTANT_TOOL_USE', timestamp: ts, toolUseIds, entry });
        return events;
      }
    }

    events.push({ type: 'ASSISTANT_STREAMING', timestamp: ts, entry });
    return events;
  }

  // queue-operation records signal background task completion
  if (entry.type === 'queue-operation' && entry.operation === 'enqueue') {
    const content = typeof entry.content === 'string' ? entry.content : '';
    if (content.includes('<status>completed</status>') || content.includes('<status>error</status>')) {
      const toolIdMatch = content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
      if (toolIdMatch) {
        events.push({ type: 'BACKGROUND_TASK_COMPLETE', timestamp: parseTimestamp(entry), toolUseId: toolIdMatch[1] });
      }
    }
  }

  if (entry.type === 'system') {
    if (entry.subtype === 'turn_duration' || entry.subtype === 'stop_hook_summary') {
      events.push({ type: 'TURN_END', timestamp: parseTimestamp(entry) });
    }
  }

  return events;
}

/**
 * Pure transition function for the state machine.
 */
function transition(ctx: MachineContext, event: MachineEvent): MachineContext {
  const next = { ...ctx, activeBackgroundTaskIds: new Set(ctx.activeBackgroundTaskIds) };

  // Background task events are state-independent
  if (event.type === 'BACKGROUND_TASK_START') {
    next.activeBackgroundTaskIds.add(event.toolUseId);
    next.lastActivityAt = event.timestamp;
    return next;
  }
  if (event.type === 'BACKGROUND_TASK_COMPLETE') {
    next.activeBackgroundTaskIds.delete(event.toolUseId);
    next.lastActivityAt = event.timestamp;
    return next;
  }

  if (event.type === 'INTERRUPTED') {
    next.lastActivityAt = event.timestamp;
    next.state = 'waiting_for_input';
    next.pendingToolIds = [];
    return next;
  }

  switch (ctx.state) {
    case 'working':
      switch (event.type) {
        case 'USER_PROMPT':
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = [];
          break;
        case 'ASSISTANT_STREAMING':
          next.lastActivityAt = event.timestamp;
          next.lastAssistantEntry = event.entry;
          break;
        case 'ASSISTANT_TOOL_USE':
          next.state = 'waiting_for_approval';
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = event.toolUseIds;
          next.lastAssistantEntry = event.entry;
          break;
        case 'TOOL_RESULT': {
          next.lastActivityAt = event.timestamp;
          const remaining = ctx.pendingToolIds.filter(id => !event.toolUseIds.includes(id));
          next.pendingToolIds = remaining;
          break;
        }
        case 'TURN_END':
          next.state = 'waiting_for_input';
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = [];
          break;
      }
      break;

    case 'waiting_for_approval':
      switch (event.type) {
        case 'TOOL_RESULT': {
          next.state = 'working';
          next.lastActivityAt = event.timestamp;
          const remaining = ctx.pendingToolIds.filter(id => !event.toolUseIds.includes(id));
          next.pendingToolIds = remaining;
          break;
        }
        case 'USER_PROMPT':
          next.state = 'working';
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = [];
          break;
        case 'ASSISTANT_STREAMING':
          next.lastActivityAt = event.timestamp;
          next.lastAssistantEntry = event.entry;
          break;
        case 'ASSISTANT_TOOL_USE':
          // New tool use while waiting — update pending tools
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = event.toolUseIds;
          next.lastAssistantEntry = event.entry;
          break;
        case 'TURN_END':
          next.state = 'waiting_for_input';
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = [];
          break;
      }
      break;

    case 'waiting_for_input':
      switch (event.type) {
        case 'USER_PROMPT':
          next.state = 'working';
          next.lastActivityAt = event.timestamp;
          break;
        case 'ASSISTANT_STREAMING':
          // Partial logs from resumed sessions
          next.lastActivityAt = event.timestamp;
          next.lastAssistantEntry = event.entry;
          break;
        case 'ASSISTANT_TOOL_USE':
          // Catching up on entries from a resumed session
          next.state = 'waiting_for_approval';
          next.lastActivityAt = event.timestamp;
          next.pendingToolIds = event.toolUseIds;
          next.lastAssistantEntry = event.entry;
          break;
        case 'TURN_END':
          next.lastActivityAt = event.timestamp;
          break;
      }
      break;
  }

  return next;
}

/**
 * Map the 3-state machine + last assistant entry → our rich SessionStateContext.
 */
function mapMachineToSessionState(ctx: MachineContext): SessionStateContext {
  const timestamp = ctx.lastActivityAt || undefined;
  const hasBg = ctx.activeBackgroundTaskIds.size > 0 || undefined;

  // Working
  if (ctx.state === 'working') {
    return { status: 'working', hasBackgroundTasks: hasBg, lastEntryTimestamp: timestamp };
  }

  // Waiting for approval — inspect last assistant entry for rich payloads
  if (ctx.state === 'waiting_for_approval' && ctx.lastAssistantEntry?.message) {
    const msg = ctx.lastAssistantEntry.message;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];

    // Find the last tool_use block (non-auto-approved)
    const lastToolUse = [...content].reverse().find(
      (b: any) => b.type === 'tool_use' && !AUTO_APPROVED_TOOLS.has(b.name)
    );

    if (lastToolUse) {
      const toolName: string = lastToolUse.name || '';
      const toolInput: Record<string, unknown> = lastToolUse.input || {};

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
          hasBackgroundTasks: hasBg,
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
        return { status: 'plan-awaiting', plan, hasBackgroundTasks: hasBg, lastEntryTimestamp: timestamp };
      }

      // Other tools → permission-awaiting
      const description = buildToolDescription(toolName, toolInput);
      const pendingTool: ToolPermissionPayload = { toolName, toolInput, description };
      return { status: 'permission-awaiting', pendingTool, hasBackgroundTasks: hasBg, lastEntryTimestamp: timestamp };
    }
  }

  // Waiting for input — idle or idle with preview
  if (ctx.state === 'waiting_for_input') {
    if (!ctx.lastAssistantEntry?.message) {
      return { status: 'idle', hasBackgroundTasks: hasBg, lastEntryTimestamp: timestamp };
    }

    const msg = ctx.lastAssistantEntry.message;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    const lastText = [...content].reverse().find((b: any) => b.type === 'text');
    const preview = lastText?.text?.slice(0, 100);
    return { status: 'idle', hasBackgroundTasks: hasBg, lastTextPreview: preview, lastEntryTimestamp: timestamp };
  }

  return { status: 'working', hasBackgroundTasks: hasBg, lastEntryTimestamp: timestamp };
}

/**
 * Derive SessionStateContext by running all entries through the state machine.
 */
function deriveStateFromEntries(entries: ParsedEntry[]): SessionStateContext {
  let machine: MachineContext = {
    state: 'waiting_for_input',
    lastActivityAt: 0,
    pendingToolIds: [],
    lastAssistantEntry: null,
    activeBackgroundTaskIds: new Set(),
  };

  for (const entry of entries) {
    const events = entryToEvents(entry);
    for (const event of events) {
      machine = transition(machine, event);
    }
  }

  // Apply stale timeout
  if (machine.lastActivityAt > 0) {
    const elapsed = Date.now() - machine.lastActivityAt;
    if (elapsed > STALE_TIMEOUT_MS) {
      if (machine.state === 'working' && machine.pendingToolIds.length === 0) {
        machine.state = 'waiting_for_input';
      } else if (machine.state === 'waiting_for_approval') {
        machine.state = 'waiting_for_input';
        machine.pendingToolIds = [];
      }
    }
  }

  return mapMachineToSessionState(machine);
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

// --- Signal file helpers ---

function parseSignalFilename(filepath: string): { sessionId: string; type: 'working' | 'permission' | 'stop' | 'ended' } | null {
  const filename = path.basename(filepath);
  const match = filename.match(/^(.+)\.(working|permission|stop|ended)\.json$/);
  if (!match) return null;
  return { sessionId: match[1], type: match[2] as 'working' | 'permission' | 'stop' | 'ended' };
}

// --- Main watcher class ---

/**
 * Watches JSONL session files and derives SessionStateContext from their content.
 * Uses chokidar for reliable file watching, incremental byte-position reading,
 * a state machine for status derivation, signal file overrides from hooks,
 * and stale timeout detection.
 *
 * Emits 'state-change' events: (sessionId, newState, prevState)
 */
export class JsonlWatcher extends EventEmitter {
  private sessions = new Map<string, WatchedSession>();
  private projectsWatcher: FSWatcher | null = null;
  private signalWatcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private staleCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Signal maps — authoritative overrides from hook scripts
  private pendingPermissions = new Map<string, PendingPermission>();
  private workingSignals = new Set<string>();
  private stopSignals = new Set<string>();
  private endedSignals = new Set<string>();

  /**
   * Start the global chokidar watchers and stale checker.
   * Call once at server startup.
   */
  startGlobalWatch(): void {
    // Watch all JSONL files under ~/.claude/projects/
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      fs.mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true });
    }

    this.projectsWatcher = watch(CLAUDE_PROJECTS_DIR, {
      persistent: true,
      ignoreInitial: true,
      depth: 2,
      ignored: /agent-.*\.jsonl$/,
    });

    this.projectsWatcher.on('change', (filepath: string) => {
      if (!filepath.endsWith('.jsonl')) return;
      for (const watched of this.sessions.values()) {
        if (watched.filePath === filepath) {
          this.debouncedProcess(watched);
          return;
        }
      }
    });

    this.projectsWatcher.on('error', () => {
      // Silently handle — directory may not exist yet
    });

    // Watch signal directory for hook outputs
    if (!fs.existsSync(SIGNALS_DIR)) {
      fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    }

    this.signalWatcher = watch(SIGNALS_DIR, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
    });

    this.signalWatcher
      .on('add', (filepath: string) => {
        if (filepath.endsWith('.json')) this.handleSignalFile(filepath);
      })
      .on('change', (filepath: string) => {
        if (filepath.endsWith('.json')) this.handleSignalFile(filepath);
      })
      .on('unlink', (filepath: string) => {
        if (filepath.endsWith('.json')) this.handleSignalRemoved(filepath);
      })
      .on('error', () => {
        // Ignore — directory may not exist if hooks aren't set up
      });

    // Load any existing signal files
    this.loadExistingSignals();

    // Start periodic stale check
    this.staleCheckInterval = setInterval(() => {
      this.checkStaleSessions();
    }, STALE_CHECK_INTERVAL_MS);
  }

  watchSession(sessionId: string, projectPath: string): void {
    if (this.sessions.has(sessionId)) return;

    const filePath = getJsonlPath(sessionId, projectPath);
    const dir = path.dirname(filePath);

    // Ensure directory exists so chokidar can see the file when it's created
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const watched: WatchedSession = {
      sessionId,
      projectPath,
      filePath,
      state: { status: 'starting' },
      bytePosition: 0,
      entries: [],
    };

    this.sessions.set(sessionId, watched);

    // Do an initial read if the file already exists
    if (fs.existsSync(filePath)) {
      this.processFile(watched);
    }
  }

  unwatchSession(sessionId: string): void {
    const watched = this.sessions.get(sessionId);
    if (!watched) return;

    // Clear any pending debounce
    const timer = this.debounceTimers.get(watched.filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(watched.filePath);
    }

    this.sessions.delete(sessionId);
  }

  getState(sessionId: string): SessionStateContext | null {
    return this.sessions.get(sessionId)?.state || null;
  }

  private debouncedProcess(watched: WatchedSession): void {
    const existing = this.debounceTimers.get(watched.filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(watched.filePath);
      this.processFile(watched);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(watched.filePath, timer);
  }

  private processFile(watched: WatchedSession): void {
    const { entries: newEntries, newPosition } = tailRead(watched.filePath, watched.bytePosition);
    if (newEntries.length === 0 && watched.entries.length > 0) return;

    // Accumulate entries and update byte position
    watched.entries.push(...newEntries);
    watched.bytePosition = newPosition;

    // Auto-clear signals based on new entries
    this.autoClearSignals(watched.sessionId, newEntries);

    // Derive state from full entry history
    let newState = deriveStateFromEntries(watched.entries);

    // Apply signal overrides (authoritative)
    newState = this.applySignalOverrides(watched.sessionId, newState);

    const prevState = watched.state;

    // Only emit if meaningful change
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
   * Apply hook signal overrides. Signals are authoritative over JSONL-derived state,
   * but rich JSONL-derived states (question/plan/permission) are preserved because
   * they carry more context than the signal alone.
   */
  private applySignalOverrides(sessionId: string, state: SessionStateContext): SessionStateContext {
    // Rich JSONL-derived states that should NOT be overridden by stop/working signals.
    // These states mean Claude is waiting for specific user interaction — the stop hook
    // fires at end of assistant turn, but these ARE the end of the turn.
    const isRichWaitingState =
      state.status === 'question-awaiting' ||
      state.status === 'questions-awaiting' ||
      state.status === 'plan-awaiting' ||
      state.status === 'permission-awaiting';

    if (this.endedSignals.has(sessionId)) {
      return { ...state, status: 'idle' };
    }
    const perm = this.pendingPermissions.get(sessionId);
    if (perm) {
      // If JSONL already derived a rich state, preserve it
      if (isRichWaitingState) {
        return state;
      }

      const toolName = perm.tool_name || '';
      const toolInput: Record<string, unknown> = perm.tool_input || {};

      // AskUserQuestion → derive question-awaiting directly from signal data
      // This handles the race where the signal arrives before the 200ms JSONL debounce
      if (toolName === 'AskUserQuestion') {
        const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
        const questionPayloads: QuestionPayload[] = questions.map((q: any) => ({
          question: q.question || '',
          header: q.header || '',
          options: (q.options || []).map((o: any) => ({
            label: o.label || '',
            description: o.description || '',
          })),
          multiSelect: q.multiSelect || false,
        }));
        // Fallback: single question string (Claude Code's typical AskUserQuestion format)
        if (questionPayloads.length === 0 && typeof toolInput.question === 'string') {
          questionPayloads.push({
            question: toolInput.question,
            header: '',
            options: [],
            multiSelect: false,
          });
        }
        return {
          ...state,
          status: questions.length > 1 ? 'questions-awaiting' : 'question-awaiting',
          questions: questionPayloads,
        };
      }

      // ExitPlanMode → derive plan-awaiting directly from signal data
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
        return { ...state, status: 'plan-awaiting', plan };
      }

      // Generic permission-awaiting for all other tools
      const pendingTool: ToolPermissionPayload = {
        toolName: perm.tool_name || 'Unknown',
        toolInput: perm.tool_input || {},
        description: buildToolDescription(perm.tool_name || 'Unknown', perm.tool_input || {}),
      };
      return { ...state, status: 'permission-awaiting', pendingTool };
    }
    if (this.stopSignals.has(sessionId)) {
      // Preserve rich waiting states — stop hook fires at end of turn but
      // question/plan/permission states ARE the end of the turn
      if (isRichWaitingState) {
        return state;
      }
      return { ...state, status: 'idle' };
    }
    if (this.workingSignals.has(sessionId)) {
      // Preserve rich waiting states — working signal from prompt submission
      // shouldn't override a question/plan that arrived after
      if (isRichWaitingState) {
        return state;
      }
      return { ...state, status: 'working' };
    }

    // JSONL-derived 'permission-awaiting' without a corresponding permission signal
    // is unreliable: the JSONL can't distinguish "waiting for user approval" from
    // "tool is auto-approved and running" (e.g. with --dangerously-skip-permissions).
    // The signal is the authoritative source for genuine permission requests.
    if (state.status === 'permission-awaiting' && !this.pendingPermissions.has(sessionId)) {
      return { ...state, status: 'working' };
    }

    return state;
  }

  /**
   * Auto-clear signals when corresponding JSONL events are detected.
   */
  private autoClearSignals(sessionId: string, newEntries: ParsedEntry[]): void {
    for (const entry of newEntries) {
      // Tool result → clear pending permission
      if (entry.type === 'user' && entry.message && Array.isArray(entry.message.content)) {
        const hasToolResult = entry.message.content.some((b: any) => b.type === 'tool_result');
        if (hasToolResult && this.pendingPermissions.has(sessionId)) {
          this.pendingPermissions.delete(sessionId);
          try { fs.unlinkSync(path.join(SIGNALS_DIR, `${sessionId}.permission.json`)); } catch {}
        }
      }
      // User prompt → clear stop signal
      if (entry.type === 'user' && entry.message) {
        const content = entry.message.content;
        if (typeof content === 'string' && this.stopSignals.has(sessionId)) {
          this.stopSignals.delete(sessionId);
          try { fs.unlinkSync(path.join(SIGNALS_DIR, `${sessionId}.stop.json`)); } catch {}
        }
      }
      // TURN_END → clear working signal (the turn is over, Claude is no longer working)
      if (entry.type === 'system' && (entry.subtype === 'turn_duration' || entry.subtype === 'stop_hook_summary')) {
        if (this.workingSignals.has(sessionId)) {
          this.workingSignals.delete(sessionId);
          try { fs.unlinkSync(path.join(SIGNALS_DIR, `${sessionId}.working.json`)); } catch {}
        }
      }
      // Interrupted → clear working signal and pending permission
      if (entry.type === 'user' && entry.message) {
        const content = entry.message.content;
        const interruptText = '[Request interrupted by user]';
        const isInterrupt = typeof content === 'string'
          ? content.includes(interruptText)
          : Array.isArray(content) && content.some(
              (b: any) => b.type === 'text' && typeof b.text === 'string' && b.text.includes(interruptText)
            );
        if (isInterrupt) {
          if (this.workingSignals.has(sessionId)) {
            this.workingSignals.delete(sessionId);
            try { fs.unlinkSync(path.join(SIGNALS_DIR, `${sessionId}.working.json`)); } catch {}
          }
          if (this.pendingPermissions.has(sessionId)) {
            this.pendingPermissions.delete(sessionId);
            try { fs.unlinkSync(path.join(SIGNALS_DIR, `${sessionId}.permission.json`)); } catch {}
          }
        }
      }
    }
  }

  /**
   * Handle a signal file being created/updated.
   */
  private handleSignalFile(filepath: string): void {
    const parsed = parseSignalFilename(filepath);
    if (!parsed) return;

    const { sessionId, type } = parsed;

    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
      return;
    }

    if (type === 'working') {
      this.workingSignals.add(sessionId);
      this.stopSignals.delete(sessionId);
    } else if (type === 'permission') {
      this.pendingPermissions.set(sessionId, data as PendingPermission);
    } else if (type === 'stop') {
      this.stopSignals.add(sessionId);
      this.workingSignals.delete(sessionId);
      this.pendingPermissions.delete(sessionId);
    } else if (type === 'ended') {
      this.endedSignals.add(sessionId);
      this.workingSignals.delete(sessionId);
      this.pendingPermissions.delete(sessionId);
      this.stopSignals.delete(sessionId);
    }

    // Re-emit state for this session if we're watching it
    const watched = this.sessions.get(sessionId);
    if (watched) {
      let newState = deriveStateFromEntries(watched.entries);
      newState = this.applySignalOverrides(sessionId, newState);
      const prevState = watched.state;
      if (newState.status !== prevState.status || newState.lastTextPreview !== prevState.lastTextPreview) {
        watched.state = newState;
        this.emit('state-change', sessionId, newState, prevState);
      }
    }
  }

  /**
   * Handle a signal file being removed.
   */
  private handleSignalRemoved(filepath: string): void {
    const parsed = parseSignalFilename(filepath);
    if (!parsed) return;

    const { sessionId, type } = parsed;

    if (type === 'working') this.workingSignals.delete(sessionId);
    else if (type === 'permission') this.pendingPermissions.delete(sessionId);
    else if (type === 'stop') this.stopSignals.delete(sessionId);
    else if (type === 'ended') this.endedSignals.delete(sessionId);

    // Re-derive state without the signal
    const watched = this.sessions.get(sessionId);
    if (watched) {
      let newState = deriveStateFromEntries(watched.entries);
      newState = this.applySignalOverrides(sessionId, newState);
      const prevState = watched.state;
      if (newState.status !== prevState.status) {
        watched.state = newState;
        this.emit('state-change', sessionId, newState, prevState);
      }
    }
  }

  /**
   * Load existing signal files on startup.
   */
  private loadExistingSignals(): void {
    try {
      const files = fs.readdirSync(SIGNALS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          this.handleSignalFile(path.join(SIGNALS_DIR, file));
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  /**
   * Periodically check for stale sessions stuck in active states.
   * Covers 'working', 'question-awaiting', 'questions-awaiting',
   * 'plan-awaiting', and 'permission-awaiting' — any state that could
   * become stale if the JSONL or signals don't update (e.g. user
   * interrupted a question via Escape and no new entries were written).
   */
  private checkStaleSessions(): void {
    for (const watched of this.sessions.values()) {
      const s = watched.state.status;
      if (s === 'idle' || s === 'starting' || s === 'exited' || s === 'error') continue;

      // Re-derive (stale timeout is built into deriveStateFromEntries)
      let newState = deriveStateFromEntries(watched.entries);
      newState = this.applySignalOverrides(watched.sessionId, newState);

      if (newState.status !== watched.state.status) {
        const prev = watched.state;
        watched.state = newState;
        this.emit('state-change', watched.sessionId, newState, prev);
      }
    }
  }

  /**
   * Proactively clear the working signal for a session (e.g. when SIGINT is sent).
   * Prevents the race where applySignalOverrides keeps overriding state to 'working'
   * because the Stop hook or JSONL interrupt entry hasn't arrived yet.
   */
  clearWorkingSignal(sessionId: string): void {
    if (!this.workingSignals.has(sessionId)) return;
    this.workingSignals.delete(sessionId);
    try { fs.unlinkSync(path.join(SIGNALS_DIR, `${sessionId}.working.json`)); } catch {}

    // Re-derive and emit so the UI updates immediately
    const watched = this.sessions.get(sessionId);
    if (watched) {
      let newState = deriveStateFromEntries(watched.entries);
      newState = this.applySignalOverrides(sessionId, newState);
      if (newState.status !== watched.state.status) {
        const prev = watched.state;
        watched.state = newState;
        this.emit('state-change', sessionId, newState, prev);
      }
    }
  }

  /**
   * Clean up all watchers on shutdown.
   */
  dispose(): void {
    if (this.projectsWatcher) {
      this.projectsWatcher.close();
      this.projectsWatcher = null;
    }
    if (this.signalWatcher) {
      this.signalWatcher.close();
      this.signalWatcher = null;
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.sessions.clear();
  }
}

// ==========================================
// History / prompt reading (unchanged)
// ==========================================

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

/**
 * Read the first user prompt from a session's JSONL file.
 * Used for auto-titling CC chats.
 */
export function readFirstUserPrompt(sessionId: string, projectPath: string): string | null {
  const filePath = getJsonlPath(sessionId, projectPath);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const entry = parseLine(line);
    if (!entry || entry.type !== 'user' || !entry.message) continue;

    const content = entry.message.content;
    if (typeof content === 'string') {
      if (content.includes('[Request interrupted by user]')) continue;
      return content.trim();
    }
    if (Array.isArray(content)) {
      const textBlock = content.find((b: any) => b.type === 'text' && b.text && !b.text.includes('[Request interrupted'));
      if (textBlock) return textBlock.text.trim();
    }
  }
  return null;
}

// Singleton instance
const jsonlWatcher = new JsonlWatcher();
export default jsonlWatcher;
