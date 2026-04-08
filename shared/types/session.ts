// === Unified Session Status (JSONL-derived, replaces SessionStatus + SDKSessionStatus) ===

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
}

