export interface TunnelRequest {
  type: 'tunnel-request';
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string; // base64
  targetPort: number;
}

export interface TunnelResponse {
  type: 'tunnel-response';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body?: string; // base64
}

export interface TunnelResponseStart {
  type: 'tunnel-response-start';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
}

export interface TunnelResponseChunk {
  type: 'tunnel-response-chunk';
  requestId: string;
  data: string; // base64
}

export interface TunnelResponseEnd {
  type: 'tunnel-response-end';
  requestId: string;
}

export interface TunnelResponseError {
  type: 'tunnel-response-error';
  requestId: string;
  error: string;
}

export interface TunnelAuth {
  type: 'auth';
  apiKey: string;
}

export interface PushEvent {
  type: 'push-event';
  event: 'chat-reply';
  data: Record<string, string>;
}

export type TunnelMessage =
  | TunnelRequest
  | TunnelResponse
  | TunnelResponseStart
  | TunnelResponseChunk
  | TunnelResponseEnd
  | TunnelResponseError
  | TunnelAuth
  | PushEvent;
