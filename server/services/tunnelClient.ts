import WebSocket from 'ws';
import http from 'http';
import type {
  TunnelRequest,
  TunnelResponse,
  TunnelResponseStart,
  TunnelResponseChunk,
  TunnelResponseEnd,
  TunnelResponseError,
} from './tunnelProtocol.ts';

let ws: WebSocket | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let shouldReconnect = false;
let currentWsUrl: string | null = null;
let currentApiKey: string | null = null;
let currentSubdomain: string | null = null;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

function getReconnectDelay(): number {
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
  reconnectAttempt++;
  return delay;
}

export function connect(wsUrl: string, apiKey: string, userSubdomain: string): void {
  // Clean up existing connection
  if (ws) {
    shouldReconnect = false;
    ws.close();
    ws = null;
  }

  currentWsUrl = wsUrl;
  currentApiKey = apiKey;
  currentSubdomain = userSubdomain;
  shouldReconnect = true;
  reconnectAttempt = 0;

  doConnect();
}

function doConnect(): void {
  if (!currentWsUrl || !currentApiKey || !shouldReconnect) return;

  console.log(`[tunnel-client] Connecting to ${currentWsUrl}...`);

  ws = new WebSocket(currentWsUrl);

  ws.on('open', () => {
    console.log('[tunnel-client] WebSocket connected, sending auth...');
    ws!.send(JSON.stringify({ type: 'auth', apiKey: currentApiKey }));
  });

  ws.on('message', (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === 'auth-ok') {
      connected = true;
      reconnectAttempt = 0;
      console.log(`[tunnel-client] Authenticated as subdomain: ${msg.subdomain}`);
      return;
    }

    if (msg.type === 'tunnel-request') {
      handleTunnelRequest(msg as TunnelRequest);
    }
  });

  ws.on('close', (code, reason) => {
    connected = false;
    ws = null;
    console.log(`[tunnel-client] WebSocket closed (code: ${code}, reason: ${reason?.toString() || 'none'})`);

    if (shouldReconnect) {
      const delay = getReconnectDelay();
      console.log(`[tunnel-client] Reconnecting in ${delay}ms...`);
      reconnectTimer = setTimeout(doConnect, delay);
    }
  });

  ws.on('error', (err) => {
    console.error('[tunnel-client] WebSocket error:', err.message);
    // The 'close' event will fire after this, triggering reconnect
  });
}

async function handleTunnelRequest(tunnelReq: TunnelRequest): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const { requestId, method, url, headers, body, targetPort } = tunnelReq;

  // Build local request options
  const reqOptions: http.RequestOptions = {
    hostname: 'localhost',
    port: targetPort,
    path: url,
    method,
    headers: { ...headers },
  };

  // Remove host header (will be set for local request)
  delete (reqOptions.headers as Record<string, string>)['host'];

  try {
    const localRes = await makeLocalRequest(reqOptions, body);

    // Check if this should be streamed
    const contentType = localRes.headers['content-type'] || '';
    const transferEncoding = localRes.headers['transfer-encoding'] || '';
    const isSSE = contentType.includes('text/event-stream');
    const isChunked = transferEncoding.includes('chunked');
    const shouldStream = isSSE || isChunked;

    // Flatten response headers
    const resHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(localRes.headers)) {
      if (value !== undefined) {
        resHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    if (shouldStream) {
      // Streaming response
      const startMsg: TunnelResponseStart = {
        type: 'tunnel-response-start',
        requestId,
        statusCode: localRes.statusCode || 200,
        headers: resHeaders,
      };
      sendMessage(startMsg);

      localRes.on('data', (chunk: Buffer) => {
        const chunkMsg: TunnelResponseChunk = {
          type: 'tunnel-response-chunk',
          requestId,
          data: chunk.toString('base64'),
        };
        sendMessage(chunkMsg);
      });

      localRes.on('end', () => {
        const endMsg: TunnelResponseEnd = {
          type: 'tunnel-response-end',
          requestId,
        };
        sendMessage(endMsg);
      });

      localRes.on('error', (err) => {
        const errMsg: TunnelResponseError = {
          type: 'tunnel-response-error',
          requestId,
          error: err.message,
        };
        sendMessage(errMsg);
      });
    } else {
      // Non-streaming: collect full response
      const chunks: Buffer[] = [];
      localRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      localRes.on('end', () => {
        const responseBody = chunks.length > 0
          ? Buffer.concat(chunks).toString('base64')
          : undefined;

        const responseMsg: TunnelResponse = {
          type: 'tunnel-response',
          requestId,
          statusCode: localRes.statusCode || 200,
          headers: resHeaders,
          body: responseBody,
        };
        sendMessage(responseMsg);
      });

      localRes.on('error', (err) => {
        const errMsg: TunnelResponseError = {
          type: 'tunnel-response-error',
          requestId,
          error: err.message,
        };
        sendMessage(errMsg);
      });
    }
  } catch (err: any) {
    const errMsg: TunnelResponseError = {
      type: 'tunnel-response-error',
      requestId,
      error: err.message || 'Failed to reach local service',
    };
    sendMessage(errMsg);
  }
}

function makeLocalRequest(
  options: http.RequestOptions,
  body?: string,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      resolve(res);
    });

    req.on('error', reject);

    if (body) {
      req.write(Buffer.from(body, 'base64'));
    }
    req.end();
  });
}

function sendMessage(msg: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function disconnect(): void {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  currentWsUrl = null;
  currentApiKey = null;
  currentSubdomain = null;
  reconnectAttempt = 0;
  console.log('[tunnel-client] Disconnected');
}

export function isConnected(): boolean {
  return connected;
}

export function waitForConnection(timeoutMs = 10_000): Promise<boolean> {
  if (connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (connected) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 200);
  });
}
