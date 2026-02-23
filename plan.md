# Claw Platform — Architecture & Migration Plan

## Vision

Claw is a cloud IDE platform with AI-native development powered by Claude. Users manage projects, run scripts, chat with Claude Agent SDK, and access everything from any device (including mobile) via a tunnel service. Pro users can upgrade to get a dedicated VPS where their code runs persistently — no laptop required.

---

## Current State

### Services

- **tunnel-service**: The central platform. Payload CMS (v3.77.0) + Express + WebSocket proxy on PostgreSQL (Railway-hosted). Handles user auth (API keys, OAuth), tunnel endpoint management, and subdomain routing. Already has collections: `Users`, `Endpoints`, `AuthorizationCodes`.
- **claude-dashboard**: Express + Socket.IO server, React client. Manages projects, scripts, terminals (xterm.js + node-pty), file browsing, Claude SDK chat sessions. Connects to tunnel-service for remote access.
- **payload-template**: Unused blank starter. Can be deleted.

### Databases (current)

- **PostgreSQL** (in tunnel-service via Payload CMS) — users, endpoints, auth codes. Hosted on Railway.
- **Filesystem JSON** (in claude-dashboard) — per-project `.claude-dashboard/config.json` files.

### Problems

- **Per-project JSON files**: Appending one chat message rewrites the entire project config (all chats, all scripts, everything).
- **Fragile file locking**: Spin-loop lock with 50ms polling. Race-prone with multiple clients.
- **No global index**: Listing projects requires scanning every directory and reading N files.
- **No partial updates**: Can't update a single chat message without serializing/deserializing the whole project.
- **No transactions**: A crash mid-write corrupts the JSON.
- **Fixed project location**: All projects must live under `~/claude-projects/`. Can't register projects in arbitrary directories.
- **No billing or plan tiers**: All users get the same capabilities. No upgrade path.

---

## Target Architecture

### Databases (target) — Two Total

```
┌──────────────────────────────────────────────────────────┐
│  PostgreSQL (tunnel-service / Payload CMS)                │
│  ── Who are the users?                                   │
│  ── What plan are they on?                               │
│  ── Where is their VPS?                                  │
│  ── Stripe subscription state                            │
│  ── Tunnel endpoint routing                              │
│  ── SSH keys (stored centrally, synced to VPS)           │
│                                                          │
│  Existing collections:                                   │
│    Users, Endpoints, AuthorizationCodes                  │
│  New collections:                                        │
│    Subscriptions, VpsInstances, SshKeys                  │
└──────────────────────┬───────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼                           ▼
┌─────────────────┐        ┌─────────────────┐
│ SQLite (local)  │        │ SQLite (on VPS) │
│ dashboard.sqlite│        │ dashboard.sqlite│
│                 │        │                 │
│ ── projects     │        │ ── projects     │
│ ── scripts      │        │ ── scripts      │
│ ── chats        │        │ ── chats        │
│ ── chat_messages│        │ ── chat_messages│
└─────────────────┘        └─────────────────┘
```

**PostgreSQL (Payload CMS)** owns all platform data: users, auth, billing, VPS state, SSH keys. This is the existing database in tunnel-service — we just add new collections.

**SQLite** owns all project/coding data: projects, scripts, chats, messages. One per dashboard instance (local machine or VPS). Single-tenant, portable, no server needed.

### System Diagram

```
┌──────────────────────────────────────────────────────────┐
│         TUNNEL-SERVICE (Payload CMS + PostgreSQL)         │
│         ═══════════════════════════════════════           │
│                                                          │
│  Existing:                    New:                       │
│  ├── Users (auth, API keys)   ├── Subscriptions (Stripe) │
│  ├── Endpoints (routing)      ├── VpsInstances (Hetzner) │
│  ├── AuthorizationCodes       ├── SshKeys (per user)     │
│  ├── OAuth flow               ├── VPS lifecycle API      │
│  ├── WebSocket tunnel proxy   ├── Stripe webhooks        │
│  └── Subdomain routing        └── Hetzner API calls      │
│                                                          │
└──────────────────┬───────────────────────────────────────┘
                   │
           ┌───────▼───────┐
           │ TUNNEL ROUTING │
           │                │
           │ user.claw.dev  │──▶ local machine (free tier)
           │                │──▶ user's VPS (pro tier)
           └────────────────┘

FREE TIER                        PRO TIER
─────────                        ────────
Runs on user's laptop            Runs on Hetzner VPS
SQLite local                     SQLite on VPS
Claude SDK (user's API key)      Claude SDK on VPS
Tunnel for mobile access         Tunnel for access (always on)
No SSH                           SSH access (keys in UI)
Projects anywhere locally        Projects on VPS + migration from local
```

---

## Phase 1: SQLite Database (claude-dashboard)

**Goal**: Replace `.claude-dashboard/config.json` with a single `dashboard.sqlite` file. Support projects in arbitrary directories.

> **IMPORTANT — No migration from old JSON configs.**
> We are starting fresh. Do NOT write migration scripts to import data from `.claude-dashboard/config.json` files into SQLite. The old JSON-based system is being fully replaced, not migrated. Any existing projects created under the old system will need to be re-added manually. Do not spend time on backwards compatibility with the old format.

### Database Schema

```sql
-- Projects can live anywhere on the filesystem
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,        -- absolute path to project directory (anywhere)
  repo TEXT,                         -- git remote URL if cloned
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scripts belong to a project
CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  command TEXT NOT NULL,
  autostart INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chats belong to a project
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'New Chat',
  sdk_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Messages belong to a chat (normalized — no more rewriting entire history)
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                -- 'user' | 'assistant'
  content TEXT NOT NULL,             -- JSON string for complex content
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  sort_order INTEGER NOT NULL        -- ordering within the chat
);

CREATE INDEX idx_scripts_project ON scripts(project_id);
CREATE INDEX idx_chats_project ON chats(project_id);
CREATE INDEX idx_messages_chat ON chat_messages(chat_id);
CREATE INDEX idx_messages_order ON chat_messages(chat_id, sort_order);
```

### Key Changes

- **Library**: `better-sqlite3` — synchronous, fast, no native compilation issues
- **Location**: `claude-dashboard/dashboard.sqlite` (gitignored)
- **Projects anywhere**: The `path` column stores an absolute path to any directory on the filesystem. No more `projectsBasePath`. User can have projects in `/Users/theo/Desktop/my-app`, `/var/www/client-site`, or anywhere else.
- **Two ways to add a project**:
  - "Create New" → creates directory at user-chosen location (or a default like `~/projects/`)
  - "Add Existing" → user selects any existing directory, dashboard registers it in SQLite
- **Chat messages normalized**: Appending a message = single `INSERT INTO chat_messages`. No more rewriting the entire project config.
- **Listing projects**: Single `SELECT * FROM projects ORDER BY created_at DESC`. No filesystem scanning.

### No Migration — Clean Break

There is no migration path from the old `.claude-dashboard/config.json` system. We start fresh:

- The old `projectManager.ts` that reads/writes JSON files gets **fully replaced**, not adapted
- The old `projectsBasePath` config is removed entirely
- Any `.claude-dashboard/` directories inside project folders are now irrelevant and can be gitignored/deleted by users
- First startup creates an empty `dashboard.sqlite` with the schema above — no scanning for old data

### Files to Change

- `server/services/projectManager.ts` — rewrite to use SQLite instead of filesystem JSON
- `server/routes/projects.ts` — update to handle `path` field, add "register existing project" endpoint
- `shared/types.ts` — update `Project` type to include `path`, remove filesystem-coupled fields
- `client/` — add "Add Existing Project" flow in UI
- New: `server/services/database.ts` — SQLite connection, schema initialization, migrations

---

## Phase 2: Extend Tunnel-Service with Plan & VPS Collections

**Goal**: Add subscription and VPS tracking to the existing Payload CMS in tunnel-service. No new service — just new collections.

### New Payload Collections

#### Subscriptions Collection

```typescript
// tunnel-service/src/collections/Subscriptions.ts
{
  slug: 'subscriptions',
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, unique: true },
    { name: 'plan', type: 'select', options: ['free', 'pro'], defaultValue: 'free', required: true },
    { name: 'stripeCustomerId', type: 'text' },
    { name: 'stripeSubscriptionId', type: 'text' },
    { name: 'status', type: 'select',
      options: ['active', 'past_due', 'canceled', 'provisioning'],
      defaultValue: 'active', required: true },
    { name: 'currentPeriodEnd', type: 'date' },
  ],
}
```

#### VpsInstances Collection

```typescript
// tunnel-service/src/collections/VpsInstances.ts
{
  slug: 'vps-instances',
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, unique: true },
    { name: 'hetznerServerId', type: 'number' },
    { name: 'name', type: 'text', required: true },
    { name: 'ipv4', type: 'text' },
    { name: 'status', type: 'select',
      options: ['provisioning', 'bootstrapping', 'running', 'stopped', 'destroying', 'destroyed'],
      defaultValue: 'provisioning', required: true },
    { name: 'region', type: 'text', defaultValue: 'ash' },       // Hetzner location
    { name: 'serverType', type: 'text', defaultValue: 'cx22' },  // Hetzner server type
    { name: 'destroyedAt', type: 'date' },
  ],
}
```

#### SshKeys Collection

```typescript
// tunnel-service/src/collections/SshKeys.ts
{
  slug: 'ssh-keys',
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
    { name: 'label', type: 'text', required: true },          // e.g. "theo@macbook"
    { name: 'publicKey', type: 'textarea', required: true },   // the actual SSH public key
    { name: 'fingerprint', type: 'text' },                     // computed from public key
  ],
}
```

### Changes to Existing Users Collection

Add a `plan` field to the existing Users collection:

```typescript
// Add to tunnel-service/src/collections/Users.ts fields:
{ name: 'plan', type: 'select', options: ['free', 'pro'], defaultValue: 'free' }
```

### New API Endpoints (in tunnel-service Express)

```
# VPS lifecycle (authenticated, checks user.plan === 'pro')
POST   /api/vps/provision     — create Hetzner VPS for user
GET    /api/vps/status         — get VPS status, IP, uptime
POST   /api/vps/stop           — stop VPS (keep disk)
POST   /api/vps/start          — start stopped VPS
DELETE /api/vps/destroy        — destroy VPS

# SSH key management (authenticated, pro only)
GET    /api/ssh-keys           — list user's SSH keys
POST   /api/ssh-keys           — add key { label, publicKey }
DELETE /api/ssh-keys/:id       — remove key

# Stripe webhooks
POST   /api/billing/webhook    — Stripe webhook receiver
```

---

## Phase 3: Hetzner VPS Integration

**Goal**: Pro users get a dedicated VPS provisioned automatically via Hetzner Cloud API.

### Why Hetzner

| Factor | Hetzner | DigitalOcean | Vultr |
|---|---|---|---|
| Cheapest usable VPS | **€3.29/mo** (CX22: 2 vCPU, 4GB, 40GB) | $6/mo (1 vCPU, 1GB) | $5/mo (1 vCPU, 1GB) |
| API quality | Clean REST API | Excellent | Good |
| Cloud-init support | Yes | Yes | Yes |
| SSH key mgmt via API | Yes | Yes | Yes |
| Snapshots via API | Yes (€0.01/GB/mo) | Yes ($0.06/GB/mo) | Yes (free) |
| Regions | EU (4) + US (2) + Singapore | Global | 25+ |
| Margin for resale | **Best** — €3.29 cost, charge $10-15/mo | $6 cost, limited margin | $5 cost, moderate margin |

### Hetzner API Integration

New service in tunnel-service: `src/services/hetznerService.ts`

```typescript
// Create a VPS
const response = await fetch('https://api.hetzner.cloud/v1/servers', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${HETZNER_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: `claw-${user.userSubdomain}`,
    server_type: 'cx22',
    image: 'ubuntu-24.04',
    location: 'ash',              // Ashburn, Virginia
    ssh_keys: [CLAW_PROVISIONING_KEY_ID],
    user_data: generateCloudInitScript(user),
  }),
});
// Returns server ID + IPv4 in ~30-60 seconds
```

### Provisioning Flow

```
User upgrades to Pro (Stripe payment succeeds)
         │
         ▼
Tunnel-service (Stripe webhook):
  1. Update Subscriptions: plan = 'pro', status = 'active'
  2. Update Users: plan = 'pro'
  3. Call Hetzner API: POST /v1/servers
  4. Create VpsInstances record: status = 'provisioning'
         │
         ▼
Hetzner creates server (~30-60 seconds)
         │
         ▼
Cloud-init bootstrap runs on VPS:
  1. Install Node.js 22 LTS, git, build-essential
  2. Create user account (claw-user)
  3. Clone claude-dashboard repo
  4. npm install
  5. Configure .env (tunnel credentials, user subdomain)
  6. Start dashboard as systemd service
  7. Sync SSH keys from central platform
  8. POST /api/vps/ready → tunnel-service
         │
         ▼
Tunnel-service:
  1. Update VpsInstances: status = 'running', ipv4 = ...
  2. Update tunnel routing: user.claw-dev.com → VPS IP
         │
         ▼
User sees "Your VPS is ready!" + migration prompt
```

### Bootstrap Script (cloud-init)

```yaml
#cloud-config
packages:
  - git
  - build-essential
  - curl

runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - apt-get install -y nodejs
  - useradd -m -s /bin/bash claw-user
  - mkdir -p /home/claw-user/projects
  - git clone https://github.com/your-org/claude-dashboard.git /opt/claw-dashboard
  - cd /opt/claw-dashboard && npm install --production
  - |
    cat > /opt/claw-dashboard/.env << 'ENVEOF'
    PORT=2222
    TUNNEL_MODE=tunnel-service
    TUNNEL_SERVICE_URL=https://tunnel-api.claw-dev.com
    TUNNEL_API_KEY=__USER_API_KEY__
    TUNNEL_USER_SUBDOMAIN=__USER_SUBDOMAIN__
    IS_VPS=true
    ENVEOF
  - |
    cat > /etc/systemd/system/claw-dashboard.service << 'SVCEOF'
    [Unit]
    Description=Claw Dashboard
    After=network.target
    [Service]
    Type=simple
    User=claw-user
    WorkingDirectory=/opt/claw-dashboard
    ExecStart=/usr/bin/node server/index.js
    Restart=always
    Environment=NODE_ENV=production
    [Install]
    WantedBy=multi-user.target
    SVCEOF
  - systemctl enable claw-dashboard
  - systemctl start claw-dashboard
  - curl -X POST https://tunnel-api.claw-dev.com/api/vps/ready \
      -H "Authorization: users API-Key __PROVISION_API_KEY__" \
      -H "Content-Type: application/json"
```

### VPS Lifecycle

```
POST   /api/vps/provision    — Hetzner create + cloud-init
GET    /api/vps/status        — query VpsInstances + Hetzner API for live stats
POST   /api/vps/stop          — Hetzner power off (disk preserved, compute billing paused)
POST   /api/vps/start         — Hetzner power on
DELETE /api/vps/destroy       — Hetzner delete server + cleanup records
POST   /api/vps/snapshot      — Hetzner create snapshot (backup)
```

---

## Phase 4: SSH Access for Pro Users

**Goal**: Pro users can SSH into their VPS from their own terminal, VS Code Remote, etc.

### How It Works

Since the dashboard runs ON the VPS, the existing in-browser terminal (xterm.js + node-pty) IS already a VPS shell. For external SSH access (own terminal, VS Code Remote-SSH):

1. The VPS runs Ubuntu with OpenSSH server (default)
2. User adds their SSH public key through the dashboard UI
3. Dashboard API stores the key in the `SshKeys` Payload collection
4. Dashboard also writes the key to `~/.ssh/authorized_keys` on the VPS
5. User connects via `ssh claw-user@<vps-ip>` or through a proxied domain

### SSH Management UI

```
┌─────────────────────────────────────────────────┐
│  SSH Access                                      │
│                                                 │
│  Host:  <VPS IPv4 or user.claw-dev.com>         │
│  Port:  22                                      │
│  User:  claw-user                               │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ ssh claw-user@203.0.113.42               │📋│
│  └───────────────────────────────────────────┘  │
│                                                 │
│  SSH Keys:                                      │
│  ┌────────────────────────────────┬──────────┐  │
│  │ theo@macbook (added Feb 20)   │ [Remove] │  │
│  │ theo@ipad (added Feb 22)      │ [Remove] │  │
│  └────────────────────────────────┴──────────┘  │
│  [+ Add SSH Key]                                │
│                                                 │
│  Or open terminal in browser:                   │
│  [Open Terminal]  ← existing xterm.js + pty     │
└─────────────────────────────────────────────────┘
```

### Implementation

- **Central storage**: SSH keys stored in Payload `SshKeys` collection (so they survive VPS reprovisioning)
- **Sync to VPS**: When a key is added/removed, tunnel-service notifies the VPS dashboard via WebSocket, which updates `~/.ssh/authorized_keys`
- **On VPS bootstrap**: Cloud-init script fetches user's SSH keys from tunnel-service and writes them to `authorized_keys`
- **Dashboard API** (runs on VPS):
  ```
  GET    /api/ssh-keys              — list keys (from Payload)
  POST   /api/ssh-keys              — add key → save to Payload + write to authorized_keys
  DELETE /api/ssh-keys/:id          — remove → delete from Payload + rewrite authorized_keys
  ```

---

## Phase 5: Stripe Billing

**Goal**: Charge for Pro tier. Auto-provision VPS on upgrade, tear down on downgrade.

### Plan Structure

| | Free | Pro |
|---|---|---|
| Price | $0 | $X/mo (TBD, e.g. $12-15/mo) |
| Runtime | User's laptop | Dedicated Hetzner VPS (CX22: 2 vCPU, 4GB, 40GB) |
| Persistence | Only when laptop is on | 24/7 |
| Claude SDK | User's own API key | User's own API key |
| SSH Access | No | Yes |
| Mobile Access | Via tunnel (laptop must be on) | Via tunnel (always available) |
| Storage | Local disk | 40GB SSD on VPS |

### Stripe Integration (in tunnel-service)

New file: `src/services/stripeService.ts`

**Setup**:
- Stripe Checkout for upgrade flow
- Stripe Customer Portal for self-service management
- Webhook endpoint at `POST /api/billing/webhook`

**Webhook Events**:
- `checkout.session.completed` → update subscription, set plan = 'pro', provision VPS
- `customer.subscription.updated` → sync plan status
- `customer.subscription.deleted` → begin downgrade flow
- `invoice.payment_failed` → notify user, mark subscription as `past_due`

### Upgrade Flow

```
User clicks "Upgrade to Pro" in dashboard
         │
         ▼
Dashboard redirects to Stripe Checkout
(via tunnel-service endpoint that creates Checkout session)
         │
         ▼
User completes payment
         │
         ▼
Stripe fires checkout.session.completed webhook → tunnel-service
         │
         ▼
Tunnel-service:
  1. Create/update Subscriptions record: plan = 'pro', status = 'active'
  2. Update Users: plan = 'pro'
  3. Provision Hetzner VPS (Phase 3 flow)
  4. Dashboard shows migration UI (Phase 6)
```

### Downgrade / Cancellation Flow

```
User cancels via Stripe Customer Portal
         │
         ▼
Stripe fires customer.subscription.deleted webhook
         │
         ▼
Tunnel-service:
  1. Notify user: "Your VPS will shut down in 7 days. Download your data."
  2. After 7-day grace period:
     a. Snapshot VPS (Hetzner API)
     b. Destroy VPS (Hetzner API)
     c. Update VpsInstances: status = 'destroyed'
     d. Update Users: plan = 'free'
     e. Tunnel routes back to local machine (if connected)
```

---

## Phase 6: Local → VPS Migration

**Goal**: When user upgrades, seamlessly migrate local projects to the VPS.

### Migration UI (shown after VPS is ready)

```
┌─────────────────────────────────────────────────┐
│  Your VPS is ready! Migrate your projects.       │
│                                                 │
│  ☑ My App              (2.3 MB, 5 chats)       │
│  ☑ Side Project         (450 KB, 2 chats)       │
│  ☐ Client Work          (1.1 GB, 12 chats)      │
│                                                 │
│  Total: 2.75 MB                                 │
│                                                 │
│  [Migrate Selected]    [Skip — Start Fresh]     │
│                                                 │
│  Migration transfers project files, chat        │
│  history, scripts, and git configuration.       │
└─────────────────────────────────────────────────┘
```

### Transfer Mechanism

The tunnel service is already a bidirectional WebSocket. Use it as the transport — no direct local↔VPS connection needed:

```
Local Dashboard ──WebSocket──▶ Tunnel Service ──WebSocket──▶ VPS Dashboard
   (tar.gz stream)               (relay)              (unpack + import)
```

### Migration Steps

1. **Local dashboard** packages each selected project:
   - tar.gz of the project directory (code, configs, .git)
   - JSON export of SQLite rows (project metadata, scripts, chats, chat_messages)
2. **Streams** the archive to VPS dashboard through the tunnel WebSocket
3. **VPS dashboard** receives and:
   - Unpacks project files to `/home/claw-user/projects/{name}/`
   - Imports metadata into VPS SQLite database
   - Preserves git remotes (VPS can `git pull` independently)
4. **Progress bar** in UI shows transfer status per project
5. **On completion**, user is redirected to VPS-hosted dashboard at `user.claw-dev.com`

### Migration API

```
# On local dashboard
POST /api/migrate/export/:projectId    — package project as tar.gz + metadata JSON

# On VPS dashboard
POST /api/migrate/import               — receive and unpack project archive
GET  /api/migrate/status               — transfer progress
```

---

## Implementation Order

| Phase | What | Depends On | Scope |
|---|---|---|---|
| **1** | SQLite migration (dashboard) | Nothing | Rewrite projectManager, add "projects anywhere", update routes + client |
| **2** | Extend tunnel-service (Payload) | Phase 1 | Add Subscriptions, VpsInstances, SshKeys collections + API routes |
| **3** | Hetzner VPS integration | Phase 2 | hetznerService, cloud-init bootstrap, VPS lifecycle API |
| **4** | SSH access UI | Phase 3 | SSH key management in dashboard, authorized_keys sync |
| **5** | Stripe billing | Phase 2-3 | stripeService, webhooks, upgrade/downgrade flows |
| **6** | Local → VPS migration | Phase 3 | Transfer protocol via tunnel WebSocket, migration UI |

Phases 4 and 5 can run in parallel once Phase 3 is done.

---

## Tech Stack Summary

| Component | Technology | Status |
|---|---|---|
| Central platform | **Tunnel-service** (Payload CMS 3.77 + Express) | Existing — extend with new collections |
| Central platform DB | **PostgreSQL** (Railway-hosted) | Existing — Payload manages schema |
| Dashboard server | Express + Socket.IO | Existing |
| Dashboard client | React + Vite | Existing |
| Dashboard DB | **SQLite** via `better-sqlite3` | New — replaces JSON config files |
| VPS provider | **Hetzner Cloud** (CX22, €3.29/mo) | New |
| VPS provisioning | Hetzner REST API + cloud-init | New |
| Billing | **Stripe** (Checkout + Webhooks + Customer Portal) | New |
| Tunnel / routing | WebSocket proxy in tunnel-service | Existing |
| Terminal | xterm.js + node-pty | Existing |
| SSH | Native OpenSSH on VPS + authorized_keys management | New |
| Auth | Payload CMS auth + API keys + OAuth | Existing |

---

## Key Design Decisions

1. **Tunnel-service IS the central platform.** No new service needed. Payload CMS already handles users, auth, API keys, OAuth, and the admin panel. We just add collections for subscriptions, VPS instances, and SSH keys.

2. **Two databases, clear separation.** PostgreSQL (via Payload in tunnel-service) owns platform data: users, billing, VPS state. SQLite (per dashboard instance) owns project data: projects, chats, scripts. No overlap.

3. **Dashboard code is tier-agnostic.** The same Express server runs locally and on VPS. The only difference is where it runs and how it connects. An `IS_VPS=true` env var enables VPS-specific features (SSH key sync, migration import endpoint).

4. **Projects can live anywhere on the filesystem.** The SQLite `projects.path` column stores the absolute path. Users can register existing directories or create new ones anywhere they want.

5. **Hetzner Cloud for VPS.** Best price/performance ratio (€3.29/mo for 2 vCPU, 4GB RAM, 40GB SSD). Clean REST API. Cloud-init support. Strong margin for resale.

6. **No file sync.** Code lives on one machine — local (free) or VPS (pro). The browser-based editor + Claude Agent SDK handles development. Users who want external access use SSH.

7. **SSH as a first-class Pro feature.** Keys stored centrally in Payload (survives VPS reprovisioning), synced to `authorized_keys` on VPS. Users can connect with any SSH client or VS Code Remote.

8. **Tunnel as migration transport.** Local → VPS project migration streams through the existing tunnel WebSocket. No direct connection between local machine and VPS needed.

9. **payload-template can be deleted.** It's an unused blank Payload starter. All Payload logic lives in tunnel-service.

---
---

# Implementation Instructions (Per Phase)

> These sections are written for a Claude Code agent. Each phase should be implemented in a separate session. Read CLAUDE.md first for project conventions.

---

## Phase 1 Instructions: SQLite Database

**Workspace**: `claude-dashboard/`

### Before you start

Read these files to understand existing patterns:
- `server/services/projectManager.ts` — the file you're replacing
- `server/routes/projects.ts` — route handlers that call projectManager
- `shared/types/models.ts` — current type definitions
- `server/config.ts` — current config (note `projectsBasePath` — you'll remove this)
- `server/index.ts` — how services/routes are wired up
- `client/src/context/ProjectContext.tsx` — how client fetches project data
- `client/src/pages/NewProjectPage.tsx` — project creation flow
- `client/src/pages/ProjectListPage.tsx` — project listing

### What to do

**Step 1: Install `better-sqlite3`**
```
cd server && npm install better-sqlite3 && npm install -D @types/better-sqlite3
```

**Step 2: Create `server/services/database.ts`**

New file. Initializes SQLite, creates tables, exports the `db` instance.

- Database location: `path.join(process.cwd(), 'data', 'dashboard.sqlite')` — create `data/` directory if it doesn't exist
- Add `data/` to `.gitignore`
- Enable WAL mode: `db.pragma('journal_mode = WAL')`
- Enable foreign keys: `db.pragma('foreign_keys = ON')`
- Create all 4 tables (projects, scripts, chats, chat_messages) with indexes on first run
- Export the db instance as default

**Step 3: Rewrite `server/services/projectManager.ts`**

Fully replace the file. Remove all filesystem JSON logic (readConfig, writeConfig, withLock, writeLocks). Replace with SQLite queries using the `db` instance from database.ts.

Methods to implement (keep the same public API where possible):

| Method | Implementation |
|---|---|
| `listProjects()` | `SELECT id, name, path, repo, created_at FROM projects ORDER BY created_at DESC` + count scripts/chats with subqueries |
| `getProject(projectId)` | `SELECT` project + join scripts + join chats. For chats, also load messages. Return assembled Project object |
| `createProject(name, path, repoUrl?)` | Generate ID from name slug + short uuid suffix. `INSERT INTO projects`. If `repoUrl`, clone with gitService. Return project |
| `registerProject(name, path)` | For "Add Existing" — just `INSERT INTO projects` pointing to the existing directory. Validate path exists on disk |
| `updateProject(projectId, updates)` | `UPDATE projects SET ... WHERE id = ?` for allowed fields (name) |
| `deleteProject(projectId)` | `DELETE FROM projects WHERE id = ?` (CASCADE handles scripts/chats/messages). Also `rm -rf` the project directory |
| `getProjectPath(projectId)` | `SELECT path FROM projects WHERE id = ?` |

Chat methods (move from route-level to service):

| Method | Implementation |
|---|---|
| `listChats(projectId)` | `SELECT * FROM chats WHERE project_id = ? ORDER BY created_at DESC` |
| `createChat(projectId, label?)` | `INSERT INTO chats` with uuid, return chat |
| `getChat(chatId)` | `SELECT chat + messages ORDER BY sort_order` |
| `updateChat(chatId, updates)` | `UPDATE chats SET ...` (label, sdk_session_id) |
| `deleteChat(chatId)` | `DELETE FROM chats WHERE id = ?` |
| `addMessage(chatId, message)` | `INSERT INTO chat_messages` with next sort_order |
| `getChatMessages(chatId)` | `SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY sort_order` |

Script methods:

| Method | Implementation |
|---|---|
| `listScripts(projectId)` | `SELECT * FROM scripts WHERE project_id = ?` |
| `createScript(projectId, label, command, autostart?)` | `INSERT INTO scripts` |
| `updateScript(scriptId, updates)` | `UPDATE scripts SET ...` |
| `deleteScript(scriptId)` | `DELETE FROM scripts WHERE id = ?` |

**Step 4: Update `shared/types/models.ts`**

- Add `path: string` to `Project` interface
- Add `path: string` to `ProjectSummary` interface
- Keep `Script`, `Chat`, `ChatHistoryEntry` interfaces as-is (they represent the API shape, not the DB shape)
- The internal DB representation of messages (chat_messages table) maps to `ChatHistoryEntry` when returned via API

**Step 5: Update `server/config.ts`**

- Remove `projectsBasePath` from `ServerConfig` and the config object
- Remove `PROJECTS_PATH` env var handling

**Step 6: Update `server/routes/projects.ts`**

- Update all route handlers to use the new projectManager methods
- Add `POST /api/projects/register` endpoint for adding existing projects:
  ```
  Body: { name: string, path: string }
  Validates: path exists on disk (fs.existsSync)
  Calls: projectManager.registerProject(name, path)
  Returns: { project }
  ```
- Update `POST /api/projects` to accept `path` field (where to create the project directory):
  ```
  Body: { name: string, path?: string, repoUrl?: string }
  If path not provided, use a default like os.homedir() + '/projects/' + slug
  ```
- Chat routes should now call projectManager.listChats/createChat/etc. instead of doing inline JSON manipulation

**Step 7: Update client**

- `NewProjectPage.tsx`: Add a path input field (or "Browse" button) for where to create the project. Add an "Add Existing Project" option that asks for name + path.
- `ProjectListPage.tsx`: Display project path in the card (small text below name)
- `ProjectContext.tsx`: No changes needed if the API response shape stays the same

### Done when

- `cd server && npx tsx index.ts` starts without errors
- `GET /api/projects` returns `[]` (empty, fresh database)
- `POST /api/projects` with `{ "name": "test", "path": "/tmp/test-project" }` creates a project and directory
- `POST /api/projects/register` with `{ "name": "existing", "path": "/some/existing/dir" }` registers it
- `GET /api/projects/:id` returns project with scripts, chats
- Chat CRUD works (create, add messages, list, delete)
- Script CRUD works (create, update, delete)
- `data/dashboard.sqlite` file exists and contains the tables
- No references to `.claude-dashboard/config.json` remain in the codebase
- No references to `projectsBasePath` remain in the codebase

---

## Phase 2 Instructions: Extend Tunnel-Service

**Workspace**: `tunnel-service/`

### Before you start

Read these files to understand existing patterns:
- `src/collections/Users.ts` — existing collection pattern
- `src/collections/Endpoints.ts` — collection with hooks, access control, relationships
- `src/collections/AuthorizationCodes.ts` — simple collection
- `src/collections/index.ts` — barrel export
- `payload.config.ts` — how collections are registered
- `src/server.ts` — where Express routes are defined, auth pattern

### What to do

**Step 1: Add `plan` field to Users collection**

Edit `src/collections/Users.ts`. Add field:
```typescript
{ name: 'plan', type: 'select', options: ['free', 'pro'], defaultValue: 'free' }
```

**Step 2: Create `src/collections/Subscriptions.ts`**

New collection following the Endpoints.ts pattern:
- Slug: `subscriptions`
- Fields: user (relationship, required, unique), plan (select: free/pro), stripeCustomerId (text), stripeSubscriptionId (text), status (select: active/past_due/canceled/provisioning), currentPeriodEnd (date)
- Access control: users can only read their own subscription (same pattern as Endpoints)

**Step 3: Create `src/collections/VpsInstances.ts`**

New collection:
- Slug: `vps-instances`
- Fields: user (relationship, required, unique), hetznerServerId (number), name (text, required), ipv4 (text), status (select: provisioning/bootstrapping/running/stopped/destroying/destroyed), region (text, default 'ash'), serverType (text, default 'cx22'), destroyedAt (date)
- Access control: users can only read their own VPS instance

**Step 4: Create `src/collections/SshKeys.ts`**

New collection:
- Slug: `ssh-keys`
- Fields: user (relationship, required), label (text, required), publicKey (textarea, required), fingerprint (text)
- Access control: users can only read/update/delete their own keys
- Hook (beforeChange on create): compute fingerprint from publicKey (optional, can be a TODO)

**Step 5: Register collections**

- Export all new collections from `src/collections/index.ts`
- Add them to the `collections` array in `payload.config.ts`

**Step 6: Add VPS lifecycle routes to `src/server.ts`**

Add these route stubs in the Express app (after existing endpoint routes). They don't need to call Hetzner yet — that's Phase 3. Just wire up the Payload CRUD:

```typescript
// POST /api/vps/provision — stub: creates VpsInstances record with status='provisioning'
// GET /api/vps/status — returns user's VPS instance from Payload
// POST /api/vps/stop — updates status to 'stopped'
// POST /api/vps/start — updates status to 'running'
// DELETE /api/vps/destroy — updates status to 'destroyed', sets destroyedAt
// POST /api/vps/ready — called by VPS bootstrap, updates status to 'running' + sets ipv4
```

All routes should use `authenticateRequest(req, payload)` for auth (same pattern as existing endpoint routes).

**Step 7: Add SSH key routes to `src/server.ts`**

```typescript
// GET /api/ssh-keys — list user's SSH keys from Payload
// POST /api/ssh-keys — create SSH key { label, publicKey }
// DELETE /api/ssh-keys/:id — delete SSH key (verify ownership)
```

**Step 8: Add Stripe webhook stub**

```typescript
// POST /api/billing/webhook — placeholder, logs the event body
// POST /api/billing/create-checkout — placeholder, returns { url: 'TODO' }
```

### Done when

- `npm run dev` starts without errors
- Payload admin panel at `/admin` shows the new collections (Subscriptions, VPS Instances, SSH Keys)
- The `plan` field appears on Users in the admin
- `POST /api/vps/provision` (with valid API key auth) creates a VpsInstances record
- `GET /api/vps/status` returns the user's VPS instance
- `POST /api/ssh-keys` creates an SSH key record
- `GET /api/ssh-keys` lists only the authenticated user's keys
- All existing functionality (tunnels, endpoints, auth) still works

---

## Phase 3 Instructions: Hetzner VPS Integration

**Workspace**: `tunnel-service/`

### Before you start

Read:
- `src/server.ts` — the VPS route stubs from Phase 2
- `src/collections/VpsInstances.ts` — the VPS data model
- Hetzner Cloud API docs: https://docs.hetzner.cloud/

### What to do

**Step 1: Add env vars**

Add to `.env`:
```
HETZNER_API_TOKEN=<your token>
HETZNER_SSH_KEY_ID=<ID of your provisioning SSH key in Hetzner>
```

**Step 2: Create `src/services/hetznerService.ts`**

New file with functions:

```typescript
// createServer(name, userData): calls POST https://api.hetzner.cloud/v1/servers
//   - server_type: 'cx22'
//   - image: 'ubuntu-24.04'
//   - location: 'ash'
//   - ssh_keys: [HETZNER_SSH_KEY_ID]
//   - user_data: the cloud-init script
//   Returns: { serverId, ipv4 }

// deleteServer(serverId): calls DELETE https://api.hetzner.cloud/v1/servers/{id}

// getServer(serverId): calls GET https://api.hetzner.cloud/v1/servers/{id}
//   Return: { status, ipv4, ... }

// stopServer(serverId): calls POST https://api.hetzner.cloud/v1/servers/{id}/actions/shutdown

// startServer(serverId): calls POST https://api.hetzner.cloud/v1/servers/{id}/actions/poweron

// createSnapshot(serverId, description): calls POST https://api.hetzner.cloud/v1/servers/{id}/actions/create_image
```

Use plain `fetch()` — no SDK needed. Auth via `Authorization: Bearer ${HETZNER_API_TOKEN}`.

**Step 3: Create `src/services/cloudInit.ts`**

Function that generates the cloud-init YAML string:

```typescript
export function generateCloudInit(params: {
  tunnelServiceUrl: string;
  userApiKey: string;
  userSubdomain: string;
  provisionCallbackUrl: string;
}): string {
  return `#cloud-config\n...`;
}
```

Use the cloud-init template from plan.md, replacing placeholders with actual values.

**Step 4: Wire up VPS routes to Hetzner**

Update the stub routes in `src/server.ts`:

- `POST /api/vps/provision`:
  1. Check user doesn't already have a VPS
  2. Check user.plan === 'pro' (or skip for now with a TODO)
  3. Generate cloud-init script
  4. Call `hetznerService.createServer()`
  5. Create VpsInstances record with hetznerServerId, status='provisioning'
  6. Return { vpsInstance }

- `POST /api/vps/ready`:
  1. Authenticate request
  2. Find user's VPS instance
  3. Update status='running', set ipv4 from request body
  4. Update tunnel routing (so user.claw-dev.com now points to VPS)

- `DELETE /api/vps/destroy`:
  1. Find user's VPS instance
  2. Call `hetznerService.deleteServer()`
  3. Update status='destroyed', set destroyedAt

- `POST /api/vps/stop` and `POST /api/vps/start`: call corresponding hetznerService methods

### Done when

- `POST /api/vps/provision` successfully calls Hetzner API and creates a real VPS
- The VPS bootstraps itself (dashboard installs, starts, connects to tunnel)
- `POST /api/vps/ready` callback is received from the VPS
- `user.claw-dev.com` routes to the VPS dashboard
- `DELETE /api/vps/destroy` deletes the Hetzner server
- `GET /api/vps/status` returns live VPS information

---

## Phase 4 Instructions: SSH Access UI

**Workspace**: `claude-dashboard/` (client + server)

### Before you start

Read:
- Phase 2's SSH key routes in tunnel-service (they handle Payload storage)
- `client/src/pages/` — existing page patterns
- `client/src/components/` — existing component patterns
- `server/config.ts` — check for `IS_VPS` env var

### What to do

**Step 1: Add SSH key sync to dashboard server (VPS mode only)**

In `server/services/`, create `sshKeyService.ts`:
- Only active when `IS_VPS=true` env var is set
- `syncAuthorizedKeys()`: fetches user's SSH keys from tunnel-service API, writes to `~/.ssh/authorized_keys`
- Called on startup and whenever a key is added/removed
- Dashboard exposes `POST /api/ssh-keys/sync` that triggers the sync (called by tunnel-service via WebSocket notification)

**Step 2: Add SSH access panel to dashboard client**

Create `client/src/components/settings/SshAccessPanel.tsx`:
- Only rendered when dashboard is in VPS mode (check via a `/api/settings` endpoint that returns `{ isVps: true/false, vpsIp: '...' }`)
- Shows connection string: `ssh claw-user@<ip>`
- Lists SSH keys (fetched from tunnel-service via dashboard proxy)
- "Add SSH Key" form: label + public key textarea
- Remove button per key
- Copy-to-clipboard button for connection string

**Step 3: Add settings endpoint to dashboard server**

Add `GET /api/settings` to return:
```json
{
  "isVps": true,
  "vpsIp": "203.0.113.42",
  "sshUser": "claw-user",
  "sshPort": 22
}
```

Values come from env vars (IS_VPS, VPS_IP set during bootstrap).

### Done when

- On a VPS instance, the SSH panel shows in the dashboard
- Users can add/remove SSH keys through the UI
- Added keys appear in `~/.ssh/authorized_keys` on the VPS
- Connection string shows the correct IP
- On non-VPS (local) instances, the SSH panel is hidden

---

## Phase 5 Instructions: Stripe Billing

**Workspace**: `tunnel-service/`

### Before you start

Read:
- Stripe Checkout docs: https://docs.stripe.com/payments/checkout
- Stripe Webhooks docs: https://docs.stripe.com/webhooks
- `src/server.ts` — the billing route stubs from Phase 2
- `src/collections/Subscriptions.ts`

### What to do

**Step 1: Install Stripe**
```
npm install stripe
```

**Step 2: Add env vars**
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
```

**Step 3: Create `src/services/stripeService.ts`**

```typescript
// createCheckoutSession(userId, userEmail): creates Stripe Checkout session
//   - mode: 'subscription'
//   - price: STRIPE_PRO_PRICE_ID
//   - metadata: { userId }
//   - success_url, cancel_url
//   Returns: { url }

// createCustomerPortalSession(stripeCustomerId): creates portal session
//   Returns: { url }
```

**Step 4: Implement billing routes**

In `src/server.ts`:

- `POST /api/billing/create-checkout`:
  1. Authenticate user
  2. Call stripeService.createCheckoutSession()
  3. Return { url }

- `POST /api/billing/customer-portal`:
  1. Authenticate user
  2. Get user's subscription (stripeCustomerId)
  3. Call stripeService.createCustomerPortalSession()
  4. Return { url }

- `POST /api/billing/webhook`:
  1. Verify Stripe signature (use `express.raw()` middleware for this route only)
  2. Handle events:
     - `checkout.session.completed`: Create Subscription record, update user.plan = 'pro', trigger VPS provisioning (call the /api/vps/provision logic)
     - `customer.subscription.updated`: Sync subscription status
     - `customer.subscription.deleted`: Set plan = 'free', mark for VPS teardown
     - `invoice.payment_failed`: Update subscription status to 'past_due'

### Done when

- `POST /api/billing/create-checkout` returns a working Stripe Checkout URL
- Completing checkout triggers the webhook and creates a Subscription record
- User's plan updates to 'pro' after successful payment
- VPS provisioning is triggered automatically after checkout
- `POST /api/billing/customer-portal` returns a portal URL for self-service management
- Subscription cancellation webhook triggers downgrade flow

---

## Phase 6 Instructions: Local → VPS Migration

**Workspace**: `claude-dashboard/` (both local and VPS instances)

### Before you start

Read:
- `server/services/database.ts` — SQLite access
- `server/services/projectManager.ts` — project data queries
- Tunnel WebSocket protocol in `tunnel-service/src/tunnel/protocol.ts`
- `server/services/tunnelClient.ts` — existing tunnel WebSocket client in dashboard

### What to do

**Step 1: Create migration export endpoint (dashboard server)**

Add `server/routes/migrate.ts`:

- `POST /api/migrate/export/:projectId`:
  1. Get project from SQLite (metadata, scripts, chats, messages)
  2. Create tar.gz of the project directory using `tar` module (npm install `tar`)
  3. Bundle: `{ metadata: { project, scripts, chats, messages }, archive: <base64 tar.gz> }`
  4. Return the bundle as JSON (for small projects) or stream it

- `GET /api/migrate/projects`:
  1. List all projects with their disk size (use `du -sh` or walk directory)
  2. Return: `[{ id, name, path, size, chatsCount, scriptsCount }]`

**Step 2: Create migration import endpoint (dashboard server, VPS mode)**

- `POST /api/migrate/import`:
  1. Only available when `IS_VPS=true`
  2. Receive the bundle
  3. Unpack tar.gz to `/home/claw-user/projects/{name}/`
  4. Insert project + scripts + chats + messages into local SQLite
  5. Return: `{ success: true, projectId }`

**Step 3: Create migration UI (dashboard client)**

Create `client/src/pages/MigrationPage.tsx`:
- Shown when user first accesses VPS dashboard after provisioning (check via API flag)
- Fetches project list from LOCAL dashboard (via tunnel — local dashboard is still running)
- Shows checkboxes for each project with size
- "Migrate Selected" button: for each selected project, calls export on local → import on VPS
- Progress bar per project
- "Skip" button to start fresh

**Step 4: Add tunnel relay for migration**

The migration data flows: local dashboard → tunnel-service → VPS dashboard. The tunnel service already proxies HTTP requests. The migration endpoints are just regular HTTP endpoints that go through the tunnel. No special WebSocket protocol needed — just use the existing HTTP tunneling.

### Done when

- `GET /api/migrate/projects` lists all projects with sizes
- `POST /api/migrate/export/:projectId` returns a bundle with project data + archive
- `POST /api/migrate/import` on VPS unpacks and imports a project
- The migration UI shows on VPS first access
- Selecting and migrating projects transfers files + data successfully
- Migrated projects appear in the VPS dashboard and work normally
