// === App Activity Monitoring Types ===

export interface AppActivityEvent {
  ts: number;
  type: 'console' | 'network' | 'error';
  port: number;
}

export interface ConsoleEvent extends AppActivityEvent {
  type: 'console';
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: string[];
}

export interface NetworkEvent extends AppActivityEvent {
  type: 'network';
  method: string;
  url: string;
  status: number;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  responseType?: string;
  bodySize?: number;
}

export interface ErrorEvent extends AppActivityEvent {
  type: 'error';
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
}

export type AppActivityEventUnion = ConsoleEvent | NetworkEvent | ErrorEvent;

// Socket.IO payloads
export interface AppActivityPayload {
  port: number;
  events: AppActivityEventUnion[];
}

export interface AppActivitySubscribePayload {
  ports: number[];
}

export interface AppActivityUnsubscribePayload {
  ports: number[];
}
