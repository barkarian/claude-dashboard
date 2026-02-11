// === Session Status ===
export type SDKSessionStatus =
  | 'starting'
  | 'idle'
  | 'streaming'
  | 'tool-use'
  | 'waiting-permission'
  | 'exited'
  | 'error';

// === Content Blocks ===
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

// === Chat Messages ===
export interface SDKChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  isPartial?: boolean;
  isError?: boolean;
  timestamp?: string;
}

// === Server → Client Payloads ===
export interface SDKMessagePayload {
  chatId: string;
  message: SDKChatMessage;
}

export interface SDKPartialUpdatePayload {
  chatId: string;
  messageId: string;
  content: ContentBlock[];
}

export interface SDKStatusPayload {
  chatId: string;
  status: SDKSessionStatus;
}

export interface SDKPermissionRequestPayload {
  chatId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description?: string;
}

// === Question (AskUserQuestion) Types ===
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface SDKQuestionRequestPayload {
  chatId: string;
  requestId: string;
  questions: Question[];
}

export interface SDKQuestionResponsePayload {
  chatId: string;
  requestId: string;
  answers: Record<number, string[]>;
}

export interface SDKResultPayload {
  chatId: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  sessionId?: string;
}

export interface SDKErrorPayload {
  chatId: string;
  error: string;
}

export interface SDKHistoryPayload {
  chatId: string;
  messages: SDKChatMessage[];
}

// === Client → Server Payloads ===
export interface SDKStartPayload {
  projectId: string;
  chatId: string;
}

export interface SDKSendPayload {
  chatId: string;
  prompt: string;
}

export interface SDKPermissionResponsePayload {
  chatId: string;
  requestId: string;
  granted: boolean;
}

export interface SDKInterruptPayload {
  chatId: string;
}

export interface SDKEndPayload {
  chatId: string;
}

export interface SDKAttachPayload {
  chatId: string;
}

export interface SDKCheckSessionPayload {
  chatId: string;
}
