# Claw Dev Platform — Implementation Phases

Full specification for taking the platform from its current state to a production SaaS with desktop and mobile apps.

**What already exists (not covered here):**
- VPS/Hetzner provisioning + billing (Stripe, free/pro plans)
- OpenRouter integration (model search, per-env credentials)
- Tunnel service with WebSocket proxy + OAuth auth flow
- Multi-mode support (local/VPS)
- SQLite database (projects, scripts, chats, messages)
- Process management with node-pty
- Chat/Claude SDK integration
- Responsive web UI

---

## Phase 1: Tunnel Service Security Hardening

**Goal:** Make the tunnel infrastructure SaaS-safe with an open-source client and developer users. All enforcement is server-side (tunnel service, closed source). The client is untrusted.

**Principle:** The open-source client app can be modified by users. Every security check must happen on the tunnel service server. The client is a convenience, not a security boundary.

### 1.1 Per-Message HMAC Signing

- **Where:** tunnel service (server-side) + `server/services/tunnelClient.ts`
- **What:** Each WebSocket message includes an HMAC-SHA256 signature derived from the API key + message body + timestamp
- **Why:** Prevents message tampering after WebSocket connection is established
- **Client change:** `tunnelClient.ts` computes HMAC for each outgoing message and includes it as a `sig` field
- **Server change:** Tunnel service validates HMAC on every incoming message. Rejects invalid signatures with WebSocket close code

### 1.2 Rate Limiting

- **Where:** tunnel service (server-side only)
- **What:**
  - Per-user: configurable req/sec + burst cap (e.g., 100 req/sec sustained, 200 burst)
  - Per-IP: secondary limit to prevent credential-sharing abuse
  - Returns HTTP 429 with `Retry-After` header
- **Implementation:** Token bucket or sliding window algorithm per user/IP
- **Plan-based:** Free plan: lower limits. Pro plan: higher limits

### 1.3 Bandwidth Metering

- **Where:** tunnel service (server-side only)
- **What:** Track bytes in + out per user per billing period
- **Enforcement:** Daily/monthly caps tied to plan (free: X GB/month, pro: Y GB/month)
- **When exceeded:** Return 503 with "bandwidth limit exceeded" message. Dashboard shows usage in settings
- **Storage:** Tunnel service database (not client SQLite)

### 1.4 Payload Size Limits

- **Where:** tunnel service + `server/index.ts`
- **What:**
  - Reduce Express JSON body limit from 500MB to 10MB (free) / 50MB (pro)
  - Tunnel service rejects oversized WebSocket messages before forwarding
- **Client change:** Update `express.json({ limit: '10mb' })` in `server/index.ts`

### 1.5 Port Allowlist Enforcement

- **Where:** tunnel service (server-side only)
- **What:** Only proxy requests to ports explicitly registered via `/api/endpoints/register`
- **Behavior:** If a `tunnel-request` targets an unregistered port, tunnel service drops it and returns an error — never forwards to the WebSocket
- **Why:** Prevents localhost port scanning through the tunnel

### 1.6 Streaming Timeouts

- **Where:** tunnel service + `server/services/tunnelClient.ts`
- **What:**
  - Max streaming duration: 30 minutes
  - Idle timeout: 60 seconds with no data chunks
  - Tunnel service sends `tunnel-response-end` and closes the stream
- **Client change:** `tunnelClient.ts` respects server-initiated stream termination

### 1.7 Connection Limits

- **Where:** tunnel service (server-side only)
- **What:** Max 2 concurrent WebSocket connections per user (1 local + 1 VPS)
- **Behavior:** Third connection attempt is rejected with WebSocket close code + reason message
- **Existing:** Code 4000 already handles "replaced by VPS" — extend this pattern

### 1.8 Request Validation

- **Where:** tunnel service (server-side only)
- **What:**
  - Whitelist HTTP methods: GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
  - Validate URL: reject path traversal (`../`), null bytes, excessively long paths
  - Enforce header size limits (e.g., max 8KB total headers)
- **Behavior:** Invalid requests are dropped, never forwarded to WebSocket

### 1.9 Replace X-Forwarded-Host Trust

- **Where:** `server/auth.ts` (client-side change) + tunnel service
- **What:**
  - Remove `tryAutoBootstrapSession()` which trusts the `X-Forwarded-Host` header
  - Instead: tunnel service injects a cryptographic session token (`X-Tunnel-Token`) into proxied requests
  - Dashboard validates this token against a shared secret or public key
- **Why:** `X-Forwarded-Host` can be spoofed. A signed token cannot
- **Impact:** `auth.ts` lines 29-57 rewritten to validate token instead of checking header

### 1.10 Input Validation in tunnelClient.ts

- **Where:** `server/services/tunnelClient.ts`
- **What:**
  - Validate `targetPort` is in the set of registered endpoints (local check against `tunnelManager.serviceTunnels`)
  - Validate `url` has no path traversal sequences
  - Validate `method` against allowed methods whitelist
- **Why:** Defense-in-depth. Even though tunnel service validates, client should too

---

## Phase 2: Public Port URLs + Offline Page

**Goal:** Port URLs are public and shareable (no login required). Dashboard URLs remain auth-protected. Offline subdomains show a friendly page instead of timing out.

### 2A: Public Port URLs

#### 2A.1 Split Routing on Tunnel Service

- **Where:** tunnel service (server-side)
- **What:** Tunnel service distinguishes two types of incoming requests:
  - Dashboard routes (`/{env}/`, `/{env}/api/*`) → require auth (session/token)
  - Port routes (`/port/{port}/` or similar pattern) → public, no auth, no session needed
- **Implementation:** Routing layer on tunnel service checks URL pattern before applying auth middleware

#### 2A.2 Permissive CORS on Port URLs

- **Where:** tunnel service (server-side)
- **What:** Port URLs return:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
  Access-Control-Allow-Headers: *
  ```
- **Why:** External tools, browsers, webhooks, and APIs need to interact with developer's services freely

#### 2A.3 Optional Per-Port Privacy Toggle

- **Where:** tunnel service + dashboard UI
- **What:**
  - Each registered port endpoint has a `public` (default) or `private` setting
  - Private ports require a share token appended to the URL (e.g., `/port/3000/?token=abc123`)
  - Toggle available in dashboard settings per port
- **Storage:** Endpoint metadata on tunnel service database
- **UI:** Simple toggle switch next to each port URL in the running processes panel

### 2B: Offline Landing Page

#### 2B.1 Connection Status Tracking

- **Where:** tunnel service (server-side)
- **What:** Track WebSocket connection state per subdomain in real-time
- **Behavior:** When a user's WebSocket disconnects, mark their subdomain as offline immediately. When reconnected, mark as online
- **Storage:** In-memory map on tunnel service (fast lookup)

#### 2B.2 Offline Page

- **Where:** tunnel service (server-side, serves static HTML)
- **What:** When a subdomain is visited but no active WebSocket connection exists:
  - Serve a branded HTML page: "This workspace is currently offline. The developer's machine is not connected."
  - Include the workspace name/subdomain
  - Branded with Claw Dev styling
- **Response:** HTTP 503 with the HTML page (not a timeout)

#### 2B.3 Auto-Refresh on Reconnect

- **Where:** offline page (client-side JavaScript)
- **What:** Offline page establishes an SSE connection or polls the tunnel service (`/api/status/{subdomain}`)
- **Behavior:** When workspace comes back online → page automatically refreshes to load the live dashboard
- **Polling interval:** Every 5 seconds

#### 2B.4 Push Notification on Offline Visit

- **Where:** tunnel service → push notification system
- **What:** When someone visits an offline subdomain:
  - Tunnel service fires a `workspace-visited-offline` event
  - Event is forwarded to push notification system (Phase 5)
  - User receives notification on mobile/desktop: "Someone tried to access your workspace"
- **Rate limiting:** Max 1 notification per 5 minutes per subdomain (prevent spam from bots/crawlers)
- **Dependency:** Push infrastructure built in Phase 5. Until then, event is logged but not delivered

---

## Phase 3: Persistent Sessions

**Goal:** Users log in once. Session survives Express/app restarts, reboots, and updates. Prerequisite for the desktop app (Phase 4).

### 3.1 File-Backed Session Store

- **Where:** `server/index.ts`
- **What:** Replace default `MemoryStore` with `better-sqlite3-session-store`
- **Why:** `better-sqlite3` is already a dependency. No new packages needed (or minimal — just the session store adapter)
- **Behavior:** Sessions stored in SQLite on disk. Survive process restarts
- **Fallback:** If SQLite session fails to initialize, fall back to MemoryStore with a warning log

### 3.2 Sessions Table

- **Where:** `server/services/database.ts`
- **What:** Add a `sessions` table to the existing SQLite schema:
  ```sql
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
  ```
- **Cleanup:** Auto-purge expired sessions on startup and periodically (every hour). TTL matches existing cookie maxAge (7 days)

### 3.3 Credential Persistence

- **Where:** `server/services/tunnelManager.ts`
- **What:**
  - On tunnel auth success: persist `tunnelServiceApiKey`, `tunnelServiceSubdomain`, and `tunnelUserInfo` to a `tunnel_credentials` table in SQLite
  - On Express startup: check for existing credentials in SQLite. If found, restore them and auto-reconnect the tunnel WebSocket
- **New table:**
  ```sql
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
- **Behavior:** Single row (id=1), upserted on login, deleted on logout
- **On startup:** If credentials exist → call `tunnelManager.setCredentials()` → WebSocket connects → user sees dashboard immediately without re-login

### 3.4 Logout Cleanup

- **Where:** `server/routes/tunnelAuth.ts` (`/disconnect` endpoint)
- **What:** On logout, delete the credential row from SQLite in addition to destroying the session
- **Ensures:** Clean slate after explicit logout. Next launch requires fresh OAuth

---

## Phase 4: Desktop App (Tauri + Node Sidecar)

**Goal:** Native desktop app for Mac and Windows. Tauri shell with Node.js Express server as a sidecar process. System tray, native notifications, auto-update, persistent login.

### 4A: Tauri Shell + Node Sidecar

#### 4A.1 Project Setup

- **Where:** new `desktop/` directory in repo root
- **What:** Tauri v2 project with:
  - `desktop/src-tauri/` — Rust Tauri backend
  - `desktop/src-tauri/tauri.conf.json` — app config (name, version, window settings)
  - `desktop/package.json` — build scripts
- **Window:** Single window, loads `http://localhost:{PORT}` after sidecar is ready
- **Permissions:** File system access (for SQLite), shell (for sidecar), notification, autostart, updater

#### 4A.2 Sidecar Lifecycle Management

- **Where:** `desktop/src-tauri/src/main.rs` (or equivalent Tauri plugin)
- **What:** Tauri main process manages the Node sidecar:
  - **Start:** On app launch, spawn `node server/index.ts` (or bundled equivalent) as child process
  - **Health check:** Poll `http://localhost:{PORT}/api/auth/status` until sidecar is ready. Show splash/loading screen while waiting
  - **Crash recovery:** If sidecar exits unexpectedly, show error dialog with "Restart" button. Auto-restart up to 3 times
  - **Shutdown:** On app quit, send SIGTERM to sidecar. Wait 5s, then SIGKILL if still running
  - **Port selection:** Use a fixed port (configurable) or find an available port dynamically
- **IPC:** Sidecar communicates with Tauri via stdout (JSON lines protocol) for events like notifications

#### 4A.3 Bundled Node.js Runtime

- **Where:** build pipeline / CI
- **What:** Bundle a standalone Node.js binary with the app so users don't need Node.js installed
- **Options:**
  - Bundle prebuilt Node.js binary (~50MB) alongside the app
  - Use `pkg` or `sea` (Node.js Single Executable Application) to create a standalone binary from the server code
- **Native modules:** `node-pty` and `better-sqlite3` must be compiled for the target platform. Use `prebuild` or compile during CI for Mac (arm64 + x64) and Windows (x64)
- **Total bundle size estimate:** ~80-100MB (Tauri ~10MB + Node ~50MB + native modules + app code)

### 4B: System Tray

#### 4B.1 Tray Icon + Status

- **Where:** `desktop/src-tauri/` using `tauri-plugin-tray`
- **What:**
  - System tray icon with connection status:
    - Green dot: tunnel WebSocket connected
    - Yellow dot: connecting/reconnecting
    - Red dot: disconnected/offline
  - Status updated via IPC from sidecar (sidecar emits connection state changes)

#### 4B.2 Tray Menu

- **Where:** `desktop/src-tauri/`
- **What:** Right-click context menu:
  - "Open Dashboard" → focus/show main window
  - "Copy URL" → copy `{user}.claw-dev.gr` to clipboard
  - "Connection: Online/Offline" → status indicator (not clickable)
  - Separator
  - "Settings" → open settings page in main window
  - "Quit" → shutdown sidecar + quit app

#### 4B.3 Minimize to Tray

- **Where:** `desktop/src-tauri/`
- **What:** Clicking the window close button hides the window instead of quitting
- **Configurable:** Toggle in settings: "Close to tray" (default on) vs "Quit on close"
- **Quit:** Only via tray menu "Quit" or Cmd+Q / Alt+F4

### 4C: Native Notifications

#### 4C.1 Notification Bridge (Sidecar → Tauri)

- **Where:** `desktop/src-tauri/src/` + `server/` changes
- **What:**
  - Express server emits JSON events to stdout when notable things happen:
    ```json
    {"type":"notification","event":"chat-reply","title":"Chat ready","body":"Agent finished responding","chatId":"abc123"}
    ```
  - Tauri main process reads sidecar stdout line-by-line, parses JSON
  - On `notification` type → trigger `tauri-plugin-notification`
- **Events:**
  - `chat-reply` — agent/chat finished responding
  - `build-complete` — script finished running (exit code 0)
  - `build-failed` — script exited with error
  - `workspace-visited-offline` — someone visited the subdomain while offline (forwarded from tunnel service via WebSocket)

#### 4C.2 Notification Actions

- **Where:** `desktop/src-tauri/`
- **What:** Clicking a notification:
  - Focuses/shows the main app window
  - Navigates to the relevant page (e.g., the chat that received a reply)
- **Implementation:** Notification payload includes a deep-link URL. Tauri handles the click event and navigates the WebView

#### 4C.3 Notification Preferences

- **Where:** dashboard UI (settings page) + Tauri local storage
- **What:** Per-event toggles:
  - "Chat replies" — on/off (default: on)
  - "Build complete" — on/off (default: on)
  - "Build failed" — on/off (default: on)
  - "Offline workspace visits" — on/off (default: on)
- **Storage:** Preferences stored in Tauri's app data directory (`tauri-plugin-store`) so they persist across updates

### 4D: Auto-Update

#### 4D.1 Update Manifest

- **Where:** hosted on your server or GitHub Releases
- **What:** JSON manifest:
  ```json
  {
    "version": "1.2.0",
    "platforms": {
      "darwin-aarch64": { "url": "https://...", "signature": "..." },
      "darwin-x86_64": { "url": "https://...", "signature": "..." },
      "windows-x86_64": { "url": "https://...", "signature": "..." }
    }
  }
  ```
- **Signature:** Ed25519 signature for each binary. Tauri verifies before applying

#### 4D.2 Update Flow

- **Where:** `desktop/src-tauri/` using `tauri-plugin-updater`
- **What:**
  - Check for updates on app launch + every 6 hours
  - If update available → show non-intrusive banner in the UI: "Update available (v1.2.0). Restart to update."
  - User clicks → download in background → verify signature → restart app with new version
  - No forced updates. User can dismiss and update later

#### 4D.3 Signed Builds (CI/CD)

- **Where:** GitHub Actions or similar CI
- **What:**
  - Mac: code-sign with Apple Developer certificate + notarize with Apple
  - Windows: code-sign with EV certificate (or standard OV cert)
  - Generate Ed25519 signature for Tauri updater
  - Upload artifacts to GitHub Releases or hosting server
- **Triggers:** Git tag push (e.g., `v1.2.0`) triggers build + sign + publish

### 4E: First-Run Experience

#### 4E.1 First-Run Detection

- **Where:** Tauri main process + sidecar
- **What:** On startup, sidecar checks SQLite for existing tunnel credentials (Phase 3)
- **If no credentials:** Sidecar emits `{"type":"first-run"}` on stdout → Tauri shows setup wizard instead of loading dashboard
- **If credentials exist:** Normal startup → auto-connect → show dashboard

#### 4E.2 Setup Wizard

- **Where:** dashboard UI (new route: `/setup`)
- **What:**
  - **Step 1:** "Welcome to Claw Dev" → "Sign up" or "Log in" buttons → OAuth flow with tunnel service
  - **Step 2:** After OAuth success → "Connect your phone (optional)" → QR code displayed (Phase 5 dependency). "Skip" button available
  - **Step 3:** "You're all set!" → show the user's URL (`{user}.claw-dev.gr`) → "Open Dashboard" button
- **One-time:** After completing setup, credentials are persisted (Phase 3). Wizard never shows again unless user logs out

#### 4E.3 Auto-Start on Login

- **Where:** `desktop/src-tauri/` using `tauri-plugin-autostart`
- **What:** Toggle in settings: "Start Claw Dev when I log in"
- **Default:** Off (user opts in)
- **Behavior:** Registers/unregisters the app with OS login items (macOS launchd, Windows registry)

### 4F: Installers & Distribution

#### 4F.1 Mac Installer

- **What:** `.dmg` file with drag-to-Applications layout
- **Signing:** Apple Developer ID certificate + notarization
- **Architectures:** Universal binary (arm64 + x64) or separate builds
- **Minimum OS:** macOS 11 (Big Sur) or later

#### 4F.2 Windows Installer

- **What:** `.msi` installer (or NSIS `.exe`)
- **Signing:** Code-signing certificate (EV preferred for SmartScreen trust)
- **Architecture:** x64
- **Minimum OS:** Windows 10 or later

#### 4F.3 Download Page

- **Where:** marketing website
- **What:** Platform detection → show appropriate download button
- **Fallback:** Manual platform selection if detection fails
- **Links:** Direct download from GitHub Releases or CDN

---

## Phase 5: Mobile App (iOS + Android)

**Goal:** Native mobile app with WebView dashboard, push notifications, QR pairing, and offline handling. Capacitor recommended (wraps existing React UI with zero rewrites).

### 5A: App Shell

#### 5A.1 Project Setup

- **Where:** new `mobile/` directory in repo root
- **What:** Capacitor project wrapping the existing React frontend
- **Why Capacitor:** Reuses the existing web UI directly. No need to rebuild screens in React Native. Native plugins for push, camera, deep links
- **Structure:**
  - `mobile/` — Capacitor project root
  - `mobile/ios/` — Xcode project (auto-generated by Capacitor)
  - `mobile/android/` — Android project (auto-generated by Capacitor)

#### 5A.2 WebView Configuration

- **What:** App opens a WebView pointing to `https://{user}.claw-dev.gr/{env}/`
- **Navigation:** Native top bar with back, forward, refresh buttons
- **Pull-to-refresh:** Native pull-to-refresh gesture reloads the WebView
- **URL persistence:** Store the user's subdomain URL locally after first login. Load it on subsequent app opens
- **No bundled UI:** The mobile app always loads from the tunnel URL (not a local build). This means the app always shows the latest UI without app updates

#### 5A.3 Deep Linking

- **What:** `claw-dev.gr` URLs (and subdomains) open in the app when installed
- **iOS:** Universal Links configuration (apple-app-site-association on tunnel service domain)
- **Android:** App Links configuration (assetlinks.json on tunnel service domain)
- **Behavior:** Tapping a `{user}.claw-dev.gr` link anywhere on the phone opens the app directly

### 5B: QR Code Pairing

#### 5B.1 QR Code Generation (Desktop Side)

- **Where:** desktop app (Tauri, Phase 4) + dashboard UI
- **What:**
  - Generate a time-limited pairing token (60-second expiry)
  - Token contains: user ID, subdomain, timestamp, HMAC signature
  - Display as QR code in: (a) first-run setup wizard, (b) settings page under "Connected Devices"
- **Library:** Any QR code generation library (e.g., `qrcode` npm package) rendered in the dashboard UI
- **Refresh:** QR auto-refreshes every 50 seconds (before expiry) with a new token

#### 5B.2 QR Scanning (Mobile Side)

- **Where:** mobile app
- **What:**
  - Native camera access via Capacitor's `@capacitor/camera` or a barcode scanner plugin
  - Scan QR → extract pairing token → validate format
  - Send token to tunnel service for pairing
- **UI:** Full-screen camera view with QR overlay. "Enter code manually" fallback for accessibility

#### 5B.3 Pairing Endpoint (Tunnel Service)

- **Where:** tunnel service (server-side)
- **What:** `POST /api/devices/pair`
  - Accepts: `{ pairingToken, devicePushToken, deviceName, platform }`
  - Validates: token signature, expiry, user existence
  - Stores: device record linked to user (device name, platform, push token, paired date)
  - Returns: `{ subdomain, dashboardUrl }` — mobile app now knows where to point its WebView
- **Security:** Token is single-use. Consumed on successful pairing

#### 5B.4 Paired Devices Management

- **Where:** dashboard UI (settings page) + tunnel service
- **What:**
  - Settings page shows list of paired devices: name, platform (iOS/Android), paired date, last active
  - "Remove device" button → `DELETE /api/devices/{deviceId}` → stops push notifications to that device
  - Tunnel service endpoint: `GET /api/devices` (list), `DELETE /api/devices/{id}` (unpair)

### 5C: Push Notifications

#### 5C.1 Push Infrastructure (Tunnel Service)

- **Where:** tunnel service (server-side)
- **What:**
  - Store device push tokens per user (from QR pairing and mobile app registration)
  - Integrate Firebase Admin SDK for sending pushes:
    - FCM (Firebase Cloud Messaging) for Android
    - APNs via FCM for iOS
  - Single sending codepath: tunnel service → FCM → device
- **Token refresh:** Mobile app sends updated push token to tunnel service periodically (tokens can rotate)

#### 5C.2 Notification Events

- **Where:** tunnel service (receives events) + Express sidecar (emits events)
- **What:** Express sidecar sends events to tunnel service via WebSocket:
  ```json
  {"type": "push-event", "event": "chat-reply", "data": {"chatId": "...", "preview": "Agent: Here's the fix..."}}
  ```
- **Events that trigger push:**
  - `chat-reply` — "Chat ready: Agent finished responding" (includes preview text)
  - `build-complete` — "Build complete: {script name} finished successfully"
  - `build-failed` — "Build failed: {script name} exited with error"
  - `workspace-visited-offline` — "Someone visited your workspace while offline"
- **Tunnel service** receives these events and fans out to all registered devices for that user

#### 5C.3 Notification Preferences

- **Where:** mobile app + tunnel service
- **What:** Per-event toggles (same as desktop, Phase 4C.3):
  - Chat replies, build complete, build failed, offline visits — each on/off
- **Storage:** Stored on tunnel service per device (so preferences sync if user reinstalls)
- **Endpoint:** `PATCH /api/devices/{id}/preferences` — `{ chatReply: true, buildComplete: false, ... }`

### 5D: Mobile-First Signup Flow

#### 5D.1 Onboarding

- **Where:** mobile app (native screens, not WebView)
- **What:**
  - **Screen 1:** "Welcome to Claw Dev" — app branding, "Get Started" button
  - **Screen 2:** "Sign up" or "Log in" — OAuth with tunnel service (opens in-app browser)
  - **Screen 3 (after auth):** Two paths:
    - **Path A:** "Connect your computer" — instructions to download desktop app → "Scan QR Code" button (opens camera)
    - **Path B:** "Start now with Pro" — Stripe checkout (in-app browser) → VPS provisioned → dashboard loads in WebView immediately
  - **Screen 4:** Dashboard loaded in WebView. Onboarding complete

#### 5D.2 No-PC Landing

- **Where:** mobile app
- **What:** If user is on free plan and hasn't connected a PC yet:
  - Show a helpful landing: "Your workspace will appear here once your computer is connected"
  - "Download desktop app" link
  - "Or upgrade to Pro for cloud hosting" link
  - Not a dead-end — always a clear next action

### 5E: Offline Handling

#### 5E.1 Offline Detection

- **Where:** mobile app
- **What:**
  - WebView fails to load (network error or tunnel service returns 503 offline page)
  - OR: app queries tunnel service status endpoint: `GET /api/status/{subdomain}` → `{ online: false }`
  - Either triggers native offline screen

#### 5E.2 Native Offline Screen

- **Where:** mobile app (native UI overlay, not WebView)
- **What:**
  - "Your workspace is offline"
  - "Your computer may not be running the Claw Dev app"
  - Icon/illustration
  - Buttons:
    - "Notify me when it's back online" → register for push notification on reconnect
    - "Send wake notification" (future: wake-on-push if desktop app supports it)
- **Not a WebView page** — this is native UI so it works even if there's no network

#### 5E.3 Reconnect Polling

- **Where:** mobile app
- **What:** While on offline screen, poll `GET /api/status/{subdomain}` every 10 seconds
- **On reconnect:** Auto-dismiss offline screen, reload WebView with the dashboard
- **Battery-conscious:** Stop polling if app is backgrounded. Resume when foregrounded

### 5F: App Distribution

#### 5F.1 iOS (App Store)

- **Where:** Apple App Store
- **Requirements:**
  - Apple Developer Account ($99/year)
  - App Store listing: screenshots, description, privacy policy
  - Capacitor WebView apps are allowed when they include native functionality (push notifications, camera for QR scanning)
- **Review notes:** Emphasize native features (push, QR, offline screen) to avoid "website wrapper" rejection
- **TestFlight:** Use for beta testing before submission

#### 5F.2 Android (Google Play)

- **Where:** Google Play Store
- **Requirements:**
  - Google Play Developer Account ($25 one-time)
  - Play Store listing: screenshots, description, privacy policy
  - Signed APK/AAB
- **Internal testing:** Use Google Play internal testing track for beta

#### 5F.3 Alternative Distribution

- **Android:** Also offer direct APK download from website (for users who prefer sideloading)
- **iOS:** No alternative (App Store only, unless enterprise distribution)

---

## Phase Dependencies & Priority

```
PHASE 3: Persistent Sessions ←── smallest, prerequisite for Phase 4
   ↓
PHASE 1: Security Hardening  ←── MUST do before any public launch
   ↓
PHASE 2: Public Ports + Offline Page ←── enables sharing, better UX
   ↓
PHASE 4: Desktop App (Tauri)        ←── main distribution vehicle
   ↕ (parallel)
PHASE 5: Mobile App (Capacitor)     ←── can develop alongside Phase 4
```

### Implementation Order Rationale

1. **Phase 3 first** — it's small (session store swap + credential persistence) and is a hard prerequisite for Phase 4's "login once" requirement
2. **Phase 1 next** — non-negotiable before any public SaaS launch. All server-side, no new platforms to learn
3. **Phase 2 next** — quick win. Public port URLs enable sharing (key feature). Offline page improves UX dramatically
4. **Phase 4 and 5 in parallel** — both are new platform work. Desktop and mobile can be developed independently. They share: push notification infrastructure (tunnel service side), QR pairing protocol, notification event format

### Cross-Phase Dependencies

- Phase 2B.4 (push on offline visit) → needs Phase 5C push infrastructure. Until then, events are logged but not delivered
- Phase 4C (desktop notifications) → standalone (uses OS native notifications, not push)
- Phase 4E.2 (QR in setup wizard) → needs Phase 5B pairing endpoint on tunnel service
- Phase 5C (push notifications) → tunnel service changes needed regardless of mobile app. Can be built early

### Security Note

SQLite remains local on user's machine (chat history, projects, sessions, credentials). This is safe because:
- It's the user's own data on their own machine
- Same trust model as SSH keys, git credentials, browser cookies
- All SaaS security enforcement is on the tunnel service (server-side, closed source)
- The client app is open source — security never depends on client-side checks
