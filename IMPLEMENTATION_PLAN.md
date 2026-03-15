# Implementation Plan — Phases 1, 2, 3

Actionable step-by-step plan with specific files, code changes, and dependencies.

---

## Phase 3: Persistent Sessions (Do First — Smallest, Prerequisite for Desktop App)

### Step 3.1: Add `sessions` and `tunnel_credentials` tables to SQLite

**File:** `server/services/database.ts`

Add to the `db.exec()` block:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

CREATE TABLE IF NOT EXISTS tunnel_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key TEXT NOT NULL,
  user_subdomain TEXT NOT NULL,
  user_id TEXT,
  email TEXT,
  username TEXT,
  plan TEXT DEFAULT 'free',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Step 3.2: Install `better-sqlite3-session-store`

**Command:** `cd server && pnpm add better-sqlite3-session-store`

If this package doesn't exist or has compatibility issues, implement a minimal custom store:
- Create `server/services/sessionStore.ts`
- Extend `express-session.Store`
- Implement `get(sid)`, `set(sid, session)`, `destroy(sid)`, `touch(sid, session)`
- Use the existing `db` instance from `database.ts`
- Add a `clearExpired()` method that deletes rows where `expired < datetime('now')`

### Step 3.3: Wire SQLite session store into Express

**File:** `server/index.ts`

Replace:
```typescript
const sessionMiddleware = session({
  name: `connect.sid.${env}`,
  secret: config.sessionSecret,
  ...
});
```

With:
```typescript
import SqliteSessionStore from './services/sessionStore.ts'; // or the npm package
import db from './services/database.ts';

const sessionMiddleware = session({
  name: `connect.sid.${env}`,
  secret: config.sessionSecret,
  store: new SqliteSessionStore({ db, clearInterval: 3600000 }), // cleanup every hour
  resave: false,
  saveUninitialized: false,
  cookie: { /* same as current */ },
});
```

### Step 3.4: Add credential persistence functions to tunnelManager

**File:** `server/services/tunnelManager.ts`

Add new functions:
- `persistCredentials(info: TunnelUserInfo)` — upsert into `tunnel_credentials` table
- `loadPersistedCredentials(): TunnelUserInfo | null` — read from `tunnel_credentials` table
- `clearPersistedCredentials()` — delete from `tunnel_credentials` table

Import `db` from `./database.ts`.

### Step 3.5: Persist credentials on OAuth success

**File:** `server/routes/tunnelAuth.ts`

After `tunnelManager.setUserInfo(userInfo)` (line 100), add:
```typescript
tunnelManager.persistCredentials(userInfo);
```

### Step 3.6: Clear persisted credentials on logout

**File:** `server/routes/tunnelAuth.ts`

In the `/disconnect` handler (line 263-274), add:
```typescript
tunnelManager.clearPersistedCredentials();
```

### Step 3.7: Auto-restore credentials on startup

**File:** `server/index.ts`

In the `server.listen()` callback, before the existing tunnel auto-connect logic (line 152), add:

```typescript
// Try to restore persisted tunnel credentials (Phase 3: persistent sessions)
if (config.tunnelMode === 'tunnel-service' && !config.tunnelApiKey) {
  const persisted = tunnelManager.loadPersistedCredentials();
  if (persisted) {
    console.log(`[startup] Restoring persisted tunnel credentials for ${persisted.username}`);
    tunnelManager.setUserInfo(persisted);
    tunnelManager.setCredentials(persisted.apiKey, persisted.userSubdomain);
  }
}
```

This runs BEFORE the existing env-var-based auto-connect, so env vars take priority over persisted credentials.

### Step 3.8: Test

- Start server → OAuth login → verify session appears in SQLite `sessions` table
- Restart server → visit dashboard URL → verify user is still logged in (no re-OAuth)
- Visit `/api/tunnel-auth/disconnect` → restart server → verify user must re-login
- Verify tunnel WebSocket auto-reconnects on restart with persisted credentials

---

## Phase 1: Tunnel Service Security Hardening

### Step 1.1: Reduce payload size limit

**File:** `server/index.ts` (line 52)

Change:
```typescript
app.use(express.json({ limit: '500mb' }));
```
To:
```typescript
app.use(express.json({ limit: '10mb' }));
```

Simple, immediate, no side effects (no legitimate request should be 10MB+).

### Step 1.2: Add HMAC signing to outgoing WebSocket messages

**File:** `server/services/tunnelClient.ts`

Add a utility function:
```typescript
import crypto from 'crypto';

function signMessage(msg: object, apiKey: string): string {
  const payload = JSON.stringify(msg);
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', apiKey)
    .update(timestamp + '.' + payload)
    .digest('hex');
  return JSON.stringify({ ...msg, _ts: timestamp, _sig: hmac });
}
```

Update `sendMessage()` (line 282-286):
```typescript
function sendMessage(msg: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (currentApiKey) {
      ws.send(signMessage(msg, currentApiKey));
    } else {
      ws.send(JSON.stringify(msg));
    }
  }
}
```

**Note:** The tunnel service (server-side, separate repo) must be updated to validate HMAC on every incoming message. That's outside this repo — document the expected validation logic.

### Step 1.3: Add input validation to handleTunnelRequest

**File:** `server/services/tunnelClient.ts`

At the top of `handleTunnelRequest()` (after line 156), add validation:

```typescript
// Validate HTTP method
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']);
if (!ALLOWED_METHODS.has(method.toUpperCase())) {
  console.warn(`[tunnel-client] Rejected invalid method: ${method}`);
  sendMessage({ type: 'tunnel-response-error', requestId, error: 'Invalid HTTP method' });
  return;
}

// Validate URL (no path traversal)
if (url.includes('..') || url.includes('\0')) {
  console.warn(`[tunnel-client] Rejected suspicious URL: ${url}`);
  sendMessage({ type: 'tunnel-response-error', requestId, error: 'Invalid URL' });
  return;
}

// Validate targetPort is a registered endpoint
const registeredPorts = tunnelManager.getRegisteredPorts();
if (!registeredPorts.has(targetPort)) {
  console.warn(`[tunnel-client] Rejected request to unregistered port: ${targetPort}`);
  sendMessage({ type: 'tunnel-response-error', requestId, error: 'Port not registered' });
  return;
}
```

### Step 1.4: Expose registered ports from tunnelManager

**File:** `server/services/tunnelManager.ts`

Add a function to expose the set of registered ports:

```typescript
function getRegisteredPorts(): Set<number> {
  const ports = new Set<number>();
  // Always include the dashboard port
  ports.add(config.port);
  // Add all registered service tunnel ports
  for (const port of serviceTunnels.keys()) {
    ports.add(port);
  }
  // Add all ngrok tunnel ports
  for (const port of ngrokTunnels.keys()) {
    ports.add(port);
  }
  return ports;
}
```

Add `getRegisteredPorts` to the default export object.

### Step 1.5: Replace X-Forwarded-Host trust with tunnel token validation

**File:** `server/auth.ts`

Replace `tryAutoBootstrapSession()` (lines 29-57) with a token-based approach:

```typescript
function tryAutoBootstrapSession(req: Request): boolean {
  if (!req.session) return false;
  if (req.session.tunnelService) return true; // already has session

  // Check for cryptographic tunnel token (injected by tunnel service)
  const tunnelToken = req.get('X-Tunnel-Token');
  if (!tunnelToken) return false;

  // Validate the token
  const userInfo = tunnelManager.getUserInfo();
  if (!userInfo || !userInfo.apiKey) return false;

  // Token format: timestamp.hmac
  // The tunnel service signs: HMAC-SHA256(apiKey, timestamp + subdomain)
  const [timestamp, signature] = tunnelToken.split('.');
  if (!timestamp || !signature) return false;

  // Reject tokens older than 5 minutes
  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age > 300000 || age < -30000) return false;

  // Verify HMAC
  const expected = crypto.createHmac('sha256', userInfo.apiKey)
    .update(timestamp + '.' + userInfo.userSubdomain)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    return false;
  }

  // Token valid — bootstrap session
  req.session.tunnelService = {
    apiKey: userInfo.apiKey,
    userSubdomain: userInfo.userSubdomain,
    userId: userInfo.userId,
    email: userInfo.email,
    username: userInfo.username,
    plan: userInfo.plan || 'free',
  };

  req.session.save((err) => {
    if (err) console.error('[auth] Failed to save token-bootstrapped session:', err);
  });

  return true;
}
```

Add `import crypto from 'crypto';` at the top of the file.

**Tunnel service side (separate repo):** Must be updated to inject `X-Tunnel-Token` header with `timestamp.hmac` format on every proxied request.

### Step 1.6: Add streaming response timeout to tunnelClient

**File:** `server/services/tunnelClient.ts`

In the streaming response handler (lines 191-225), add timeout logic:

```typescript
if (shouldStream) {
  const MAX_STREAM_DURATION = 30 * 60 * 1000; // 30 minutes
  const IDLE_TIMEOUT = 60 * 1000; // 60 seconds

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const maxTimer = setTimeout(() => {
    localRes.destroy();
    sendMessage({ type: 'tunnel-response-end', requestId });
    console.log(`[tunnel-client] Stream max duration reached for ${requestId}`);
  }, MAX_STREAM_DURATION);

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      localRes.destroy();
      sendMessage({ type: 'tunnel-response-end', requestId });
      console.log(`[tunnel-client] Stream idle timeout for ${requestId}`);
    }, IDLE_TIMEOUT);
  };

  // Start idle timer
  resetIdleTimer();

  // ... existing startMsg send ...

  localRes.on('data', (chunk: Buffer) => {
    resetIdleTimer(); // Reset on each chunk
    // ... existing chunk send ...
  });

  localRes.on('end', () => {
    clearTimeout(maxTimer);
    if (idleTimer) clearTimeout(idleTimer);
    // ... existing end send ...
  });

  localRes.on('error', (err) => {
    clearTimeout(maxTimer);
    if (idleTimer) clearTimeout(idleTimer);
    // ... existing error send ...
  });
}
```

### Step 1.7: Document tunnel service (server-side) requirements

**File:** `TUNNEL_SERVICE_REQUIREMENTS.md` (new file, root directory)

Document what the tunnel service (separate repo/server) must implement:
- HMAC validation on every incoming WebSocket message (matching Step 1.2 format)
- Rate limiting: per-user req/sec + burst, per-IP secondary limit
- Bandwidth metering: bytes in/out per user, enforce caps by plan
- Payload size enforcement: reject oversized WS messages before forwarding
- Port allowlist: only forward requests to registered ports
- Connection limits: max 2 WS per user
- Request validation: method whitelist, URL validation, header size limits
- Inject `X-Tunnel-Token` header on proxied requests (matching Step 1.5 format)

This is a reference doc for implementing the server-side security in the tunnel service repo.

---

## Phase 2: Public Port URLs + Offline Page

### Step 2.1: Document tunnel service routing split

Most of Phase 2 is tunnel service (server-side) work. On the dashboard side, changes are minimal.

**Tunnel service requirements (add to `TUNNEL_SERVICE_REQUIREMENTS.md`):**

- **Route splitting:**
  - Requests to `/{env}/` and `/{env}/api/*` → require auth (existing behavior)
  - Requests to `/port/{port}/*` → public, no auth. Forward to WebSocket with `targetPort={port}`
  - Port routes skip session/cookie checks entirely

- **CORS for port routes:**
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS`
  - `Access-Control-Allow-Headers: *`
  - Only on `/port/{port}/*` routes, NOT on dashboard routes

### Step 2.2: Add port privacy toggle to endpoint registration

**File:** `server/services/tunnelManager.ts`

Update `ensureServiceTunnel()` to include a `public` flag in the registration payload:

```typescript
body: JSON.stringify({
  projectUUID,
  port,
  mode: config.dashboardEnv,
  isPublic: true, // default: public
}),
```

**File:** `server/services/tunnelManager.ts` — `TunnelServiceEntry` interface

Add `isPublic: boolean` field to the interface and the `serviceTunnels` map values.

### Step 2.3: Add port privacy toggle API endpoint

**File:** `server/routes/scripts.ts` (or new `server/routes/ports.ts`)

Add endpoint:
```
PATCH /api/ports/:port/privacy
Body: { isPublic: boolean }
```

Implementation:
- Find the endpoint in `tunnelManager.serviceTunnels`
- Call tunnel service API: `PATCH /api/endpoints/{endpointId}` with `{ isPublic }`
- Update local cache

### Step 2.4: Add port privacy toggle to frontend

**File:** client component that displays running processes / tunnel URLs

Add a toggle switch next to each port URL:
- "Public" (default) — anyone with the link can access
- "Private" — requires share token in URL
- Calls `PATCH /api/ports/:port/privacy` on toggle

### Step 2.5: Document offline page requirements for tunnel service

**Add to `TUNNEL_SERVICE_REQUIREMENTS.md`:**

- **Connection status tracking:**
  - Maintain an in-memory map of `subdomain → { connected: boolean, lastSeen: Date }`
  - Update on WebSocket connect/disconnect events
  - Expose via API: `GET /api/status/{subdomain}` → `{ online: boolean }`

- **Offline landing page:**
  - When a request arrives for a subdomain with no active WebSocket:
    - Return HTTP 503 with branded HTML page
    - Page content: "This workspace is currently offline"
    - Include subdomain name in the page
    - Include client-side JS that polls `GET /api/status/{subdomain}` every 5 seconds
    - Auto-redirect to dashboard when status becomes online
  - Static HTML served from tunnel service (no dependency on dashboard)

- **Offline visit notification:**
  - When offline page is served, emit a `workspace-visited-offline` event
  - Rate limit: max 1 event per 5 minutes per subdomain
  - Event forwarded via push notification system (Phase 5) when available
  - Until Phase 5: log the event for future delivery

### Step 2.6: Handle offline visit notification on dashboard side

**File:** `server/services/tunnelClient.ts`

Add handler for a new WebSocket message type from tunnel service:

```typescript
if (msg.type === 'offline-visit') {
  console.log(`[tunnel-client] Someone visited workspace while offline`);
  // Emit to Socket.IO for any connected dashboard clients
  // (Relevant for Phase 4 desktop notifications)
  // For now, just log it
}
```

---

## File Change Summary

### Phase 3 (Persistent Sessions)
| File | Change |
|------|--------|
| `server/services/database.ts` | Add `sessions` and `tunnel_credentials` tables |
| `server/services/sessionStore.ts` | **New file** — SQLite session store for express-session |
| `server/index.ts` | Wire SQLite session store; add credential auto-restore on startup |
| `server/services/tunnelManager.ts` | Add `persistCredentials()`, `loadPersistedCredentials()`, `clearPersistedCredentials()` |
| `server/routes/tunnelAuth.ts` | Call `persistCredentials()` on login, `clearPersistedCredentials()` on logout |

### Phase 1 (Security Hardening)
| File | Change |
|------|--------|
| `server/index.ts` | Reduce JSON limit from 500MB to 10MB |
| `server/services/tunnelClient.ts` | Add HMAC signing, input validation, streaming timeouts |
| `server/services/tunnelManager.ts` | Add `getRegisteredPorts()` function |
| `server/auth.ts` | Replace X-Forwarded-Host trust with HMAC token validation |
| `TUNNEL_SERVICE_REQUIREMENTS.md` | **New file** — server-side security requirements for tunnel service repo |

### Phase 2 (Public Ports + Offline)
| File | Change |
|------|--------|
| `server/services/tunnelManager.ts` | Add `isPublic` to endpoint registration |
| `server/routes/scripts.ts` or new `server/routes/ports.ts` | Add `PATCH /api/ports/:port/privacy` endpoint |
| `server/services/tunnelClient.ts` | Handle `offline-visit` WebSocket message type |
| `TUNNEL_SERVICE_REQUIREMENTS.md` | Add routing split, CORS, offline page, and notification requirements |
| Client component (running processes) | Add port privacy toggle UI |

---

## Implementation Order (Within Each Phase)

```
Phase 3:  3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 (test)
Phase 1:  1.1 → 1.3 → 1.4 → 1.2 → 1.5 → 1.6 → 1.7
Phase 2:  2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6
```

Phase 3 steps are sequential (each builds on the previous).
Phase 1 steps 1.1, 1.3/1.4, 1.2, 1.5, 1.6 can be done in any order — they're independent.
Phase 2 steps 2.2-2.4 depend on 2.1 (tunnel service routing split must exist first for port URLs to work).
