// === Unified Session Status (JSONL-derived, replaces SessionStatus + SDKSessionStatus) ===

export type UnifiedStatus =
  | 'starting'            // Process launching, no JSONL yet
  | 'idle'                // stop_reason == 'end_turn', waiting for next prompt
  | 'working'             // Streaming or tool execution in progress
  | 'question-awaiting'   // AskUserQuestion, questions.length == 1
  | 'questions-awaiting'  // AskUserQuestion, questions.length > 1
  | 'plan-awaiting'       // ExitPlanMode, waiting for accept/reject
  | 'permission-awaiting' // Bash/Edit/Write etc. pending approval
  | 'interrupted'         // "[Request interrupted by user]"
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

export interface SessionStateContext {
  status: UnifiedStatus;
  questions?: QuestionPayload[];       // Stored in full for future interactive UI
  plan?: PlanPayload;
  pendingTool?: ToolPermissionPayload;
  lastTextPreview?: string;            // For notifications
  lastEntryTimestamp?: number;
}

// === Legacy compat ===

type LegacyStatus = 'starting' | 'idle' | 'thinking' | 'waiting-input' | 'exited';

/** Map UnifiedStatus to legacy SessionStatus for gradual UI migration */
export function mapToLegacyStatus(status: UnifiedStatus): LegacyStatus {
  switch (status) {
    case 'starting': return 'starting';
    case 'idle': return 'idle';
    case 'working': return 'thinking';
    case 'question-awaiting':
    case 'questions-awaiting':
    case 'plan-awaiting':
    case 'permission-awaiting': return 'waiting-input';
    case 'interrupted': return 'idle';
    case 'exited': return 'exited';
    case 'error': return 'exited';
    default: return 'idle';
  }
}
