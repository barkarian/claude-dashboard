# Tunnel Service (Server-Side) Requirements

This document describes what the tunnel service (separate repo/server) must implement to support the dashboard's security hardening and public port features.

---

## Phase 1: Security Hardening

### HMAC Validation on Incoming WebSocket Messages

Every incoming WebSocket message from a dashboard client includes `_ts` (timestamp) and `_sig` (HMAC-SHA256 signature).

**Validation logic:**
1. Extract `_ts` and `_sig` from the incoming message
2. Reconstruct the payload without `_ts` and `_sig`
3. Compute: `HMAC-SHA256(apiKey, _ts + '.' + JSON.stringify(payload))`
4. Compare computed HMAC with `_sig` using constant-time comparison
5. Reject messages with `_ts` older than 5 minutes or in the future by more than 30 seconds
6. Drop messages that fail validation

### Rate Limiting

- **Per-user:** Max requests/second with burst allowance (suggested: 50 req/s sustained, 100 burst)
- **Per-IP secondary limit:** Prevent abuse from unauthenticated connections
- Return HTTP 429 when limits are exceeded

### Bandwidth Metering

- Track bytes in/out per user per billing period
- Enforce bandwidth caps by plan:
  - Free: 1 GB/month
  - Pro: 50 GB/month
- Return HTTP 509 (or 429) when caps are exceeded

### Payload Size Enforcement

- Reject oversized WebSocket messages before forwarding (max 10MB per message)
- Close connections that repeatedly send oversized messages

### Port Allowlist

- Only forward requests to ports that are registered as active endpoints for the user
- Reject requests to unregistered ports with HTTP 403

### Connection Limits

- Max 2 WebSocket connections per user (one per dashboard env: local + vps)
- When a 3rd connection arrives, close the oldest with close code 4000

### Request Validation

- HTTP method whitelist: GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
- URL validation: reject paths containing `..` or null bytes
- Header size limits: max 16KB total headers per request

### X-Tunnel-Token Header Injection

On every proxied HTTP request forwarded to the dashboard, inject:
```
X-Tunnel-Token: {timestamp}.{hmac}
```

Where:
- `timestamp` = `Date.now()` at time of proxying
- `hmac` = `HMAC-SHA256(apiKey, timestamp + '.' + userSubdomain)`

The dashboard validates this token in `auth.ts` to bootstrap sessions for tunnel-proxied requests.

---

## Phase 2: Public Port URLs + Offline Page

### Route Splitting

- Requests to `/{env}/` and `/{env}/api/*` require auth (existing behavior)
- Requests to `/port/{port}/*` are public, no auth required
  - Forward to WebSocket with `targetPort={port}`
  - Port routes skip session/cookie checks entirely

### CORS for Port Routes

Only on `/port/{port}/*` routes (NOT on dashboard routes):
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
Access-Control-Allow-Headers: *
```

### Connection Status Tracking

- Maintain an in-memory map of `subdomain -> { connected: boolean, lastSeen: Date }`
- Update on WebSocket connect/disconnect events
- Expose via API: `GET /api/status/{subdomain}` -> `{ online: boolean }`

### Offline Landing Page

When a request arrives for a subdomain with no active WebSocket:
- Return HTTP 503 with branded HTML page
- Page content: "This workspace is currently offline"
- Include subdomain name in the page
- Include client-side JS that polls `GET /api/status/{subdomain}` every 5 seconds
- Auto-redirect to dashboard when status becomes online
- Static HTML served from tunnel service (no dependency on dashboard)

### Offline Visit Notification

- When offline page is served, emit a `workspace-visited-offline` event via WebSocket
- Rate limit: max 1 event per 5 minutes per subdomain
- Event format: `{ type: 'offline-visit', subdomain: string, timestamp: number }`
- Until push notification system is available, log the event for future delivery
