export type AllowedKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Escape' | 'Tab' | 'ShiftTab';
export type SessionStatus = 'starting' | 'idle' | 'thinking' | 'waiting-input' | 'exited';
export type InteractiveType = 'selection-menu' | 'permission-prompt' | 'multi-option-confirmation' | 'simple-confirmation' | 'text-input' | 'navigation-hint' | 'manual';

export interface InteractiveState {
  type: InteractiveType;
  options: string[];
  selectedIndex: number;
  navigation?: string;
  prompt?: string;
}

export interface BufferAnalysis {
  sessionStatus: SessionStatus;
  interactive: InteractiveState | null;
}

// Socket event payloads
export interface StatusPayload { chatId: string; status: SessionStatus; exitCode?: number }
export interface InteractivePayload { chatId: string; interactive: InteractiveState | null }
export interface OutputPayload { chatId: string; data: string; promptId: string | null }
export interface KeySequencePayload { chatId: string; key: AllowedKey }
export interface SendPayload { chatId: string; prompt: string; promptId: string }
export interface ConfirmPayload { chatId: string; answer: string }
export interface StartPayload { projectId: string; chatId: string }
export interface ErrorPayload { chatId: string; error: string }
export interface ResponseCompletePayload { chatId: string; promptId: string; response: string }
export interface AttachPayload { chatId: string }
