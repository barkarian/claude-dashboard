// === Unified Session Status (JSONL-derived, replaces SessionStatus + SDKSessionStatus) ===
// These are the base statuses used by shared chrome (sidebar badges, header dots).
// Adapters must map their internal state to one of these.

export type UnifiedStatus =
  | 'starting'            // Process launching, no JSONL yet
  | 'idle'                // stop_reason == 'end_turn' OR interrupted — waiting for next prompt
  | 'working'             // Streaming or tool execution in progress
  | 'question-awaiting'   // AskUserQuestion, questions.length == 1
  | 'questions-awaiting'  // AskUserQuestion, questions.length > 1
  | 'plan-awaiting'       // ExitPlanMode, waiting for accept/reject
  | 'permission-awaiting' // Bash/Edit/Write etc. pending approval
  | 'exited'
  | 'error';

// === JSONL State Payloads ===

export interface QuestionPayload {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
  selectedIndex?: number; // For future arrow-button UI
}

export interface PlanPayload {
  plan: string;           // Full markdown
  planFilePath: string;
  allowedPrompts: Array<{ tool: string; prompt: string }>;
}

export interface ToolPermissionPayload {
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
}

export interface ContextUsage {
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  contextWindowMax: number;            // Model's max context window
  effectiveContext: number;            // input + cacheCreation + cacheRead
  percentage: number;                  // effectiveContext / contextWindowMax * 100
}

export interface SessionStateContext {
  status: UnifiedStatus;
  questions?: QuestionPayload[];       // Stored in full for future interactive UI
  plan?: PlanPayload;
  pendingTool?: ToolPermissionPayload;
  hasBackgroundTasks?: boolean;        // True when run_in_background Bash tasks are active
  lastTextPreview?: string;            // For notifications
  lastEntryTimestamp?: number;
  contextUsage?: ContextUsage;         // Token usage from last assistant turn

  // === Adapter extension fields ===

  /** Adapter-specific status label (e.g. "Indexing codebase...", "Applying edits").
   *  Shared chrome uses `status` for badge color; the header can prefer this for label text. */
  adapterStatus?: string;
  /** Adapter-specific structured metadata (e.g. { progress: 42 }) */
  adapterStatusMeta?: Record<string, unknown>;
  /** Adapter-provided badges for the header area (e.g. model name, cost) */
  headerBadges?: Array<{ label: string; icon?: string; tooltip?: string }>;
}

