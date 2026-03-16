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
import credentialService from './credentialService.ts';
import config from '../config.ts';

// Current active WebSocket (only this one should handle events)
let ws: WebSocket | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let shouldReconnect = false;
let currentWsUrl: string | null = null;
let currentApiKey: string | null = null;
let currentSubdomain: string | null = null;

// Session token received from tunnel-service on auth-ok
let currentSessionToken: string | null = null;

// Generation counter: incremented on each connect() call.
// Stale WebSocket event handlers check this to avoid corrupting new connections.
let generation = 0;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

function getReconnectDelay(): number {
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
  reconnectAttempt++;
  return delay;
}

export function connect(wsUrl: string, apiKey: string, userSubdomain: string): void {
  const keyPreview = apiKey ? apiKey.slice(0, 8) + '...' : 'EMPTY';
  console.log(`[tunnel-client] connect called: wsUrl=${wsUrl}, subdomain=${userSubdomain}, apiKey=${keyPreview}`);

  // Bump generation so any stale event handlers from the old WS become no-ops
  generation++;

  // Clear any pending reconnect timer from previous connection
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Clean up existing connection
  if (ws) {
    console.log('[tunnel-client] Closing existing WebSocket before reconnect');
    const oldWs = ws;
    ws = null;
    connected = false;
    // Remove all listeners so stale events can't fire
    oldWs.removeAllListeners();
    oldWs.close();
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

  // Capture generation at the time this socket is created.
  // If generation changes (new connect() call), all handlers become no-ops.
  const myGeneration = generation;
  const socket = new WebSocket(currentWsUrl);
  ws = socket;

  socket.on('open', () => {
    if (myGeneration !== generation) {
      console.log('[tunnel-client] Stale WS open event (generation mismatch), ignoring');
      socket.close();
      return;
    }
    console.log('[tunnel-client] WebSocket connected, sending auth...');
    socket.send(JSON.stringify({ type: 'auth', apiKey: currentApiKey, mode: config.dashboardEnv }));
  });

  socket.on('message', (data) => {
    if (myGeneration !== generation) return; // stale

    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === 'auth-ok') {
      connected = true;
      reconnectAttempt = 0;
      currentSessionToken = msg.sessionToken || null;
      console.log(`[tunnel-client] Authenticated as subdomain: ${msg.subdomain}`);
      return;
    }

    if (msg.type === 'credential-sync') {
      console.log('[tunnel-client] Received credential-sync push, syncing...');
      credentialService.syncCredentials();
      return;
    }

    if (msg.type === 'tunnel-request') {
      handleTunnelRequest(msg as TunnelRequest);
    }
  });

  socket.on('close', (code, reason) => {
    if (myGeneration !== generation) {
      console.log(`[tunnel-client] Stale WS close event (generation mismatch), ignoring`);
      return;
    }

    connected = false;
    ws = null;
    console.log(`[tunnel-client] WebSocket closed (code: ${code}, reason: ${reason?.toString() || 'none'})`);

    // Code 4000 = replaced by VPS connection. Stop reconnecting.
    if (code === 4000) {
      shouldReconnect = false;
      console.log('[tunnel-client] Connection replaced by VPS — stopping reconnect');
      return;
    }

    if (shouldReconnect) {
      const delay = getReconnectDelay();
      console.log(`[tunnel-client] Reconnecting in ${delay}ms...`);
      reconnectTimer = setTimeout(doConnect, delay);
    }
  });

  socket.on('error', (err) => {
    if (myGeneration !== generation) return; // stale
    console.error('[tunnel-client] WebSocket error:', err.message);
    // The 'close' event will fire after this, triggering reconnect
  });
}

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

async function handleTunnelRequest(tunnelReq: TunnelRequest): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log(`[tunnel-client] handleTunnelRequest: WebSocket not ready (ws=${!!ws}, readyState=${ws?.readyState})`);
    return;
  }

  const { requestId, method, url, headers, body, targetPort } = tunnelReq;

  // --- Input validation ---
  // Validate targetPort against registered endpoints (lazy import to avoid circular dep)
  const { default: tunnelManager } = await import('./tunnelManager.ts');
  const registeredPorts = tunnelManager.getRegisteredPorts();
  if (!registeredPorts.has(targetPort)) {
    sendMessage({ type: 'tunnel-response-error', requestId, error: 'Port not registered' });
    return;
  }

  // Validate URL
  if (url.includes('..') || url.includes('\0')) {
    sendMessage({ type: 'tunnel-response-error', requestId, error: 'Invalid URL' });
    return;
  }

  // Validate method
  if (!ALLOWED_METHODS.includes(method.toUpperCase())) {
    sendMessage({ type: 'tunnel-response-error', requestId, error: 'Method not allowed' });
    return;
  }

  console.log(`[tunnel-client] Handling tunnel request: ${method} ${url} -> localhost:${targetPort} (reqId=${requestId.slice(0, 8)}..., cookie=${headers.cookie ? 'present' : 'MISSING'})`);

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
    console.log(`[tunnel-client] Local response: ${localRes.statusCode} for ${method} ${url}`);

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
      // Streaming response with max-duration timeout
      const MAX_STREAM_DURATION_MS = 30 * 60 * 1000; // 30 minutes
      const maxDurationTimer = setTimeout(() => {
        localRes.destroy();
        const endMsg: TunnelResponseEnd = { type: 'tunnel-response-end', requestId };
        sendMessage(endMsg);
      }, MAX_STREAM_DURATION_MS);

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
        clearTimeout(maxDurationTimer);
        const endMsg: TunnelResponseEnd = {
          type: 'tunnel-response-end',
          requestId,
        };
        sendMessage(endMsg);
      });

      localRes.on('error', (err) => {
        clearTimeout(maxDurationTimer);
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
  generation++; // invalidate all stale handlers
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    const oldWs = ws;
    ws = null;
    oldWs.removeAllListeners();
    oldWs.close();
  }
  connected = false;
  currentWsUrl = null;
  currentApiKey = null;
  currentSubdomain = null;
  currentSessionToken = null;
  reconnectAttempt = 0;
  console.log('[tunnel-client] Disconnected');
}

export function getSessionToken(): string | null {
  return currentSessionToken;
}

export function isConnected(): boolean {
  return connected;
}
