// playwrightSessionManager — server-side singleton that owns the persistent
// Chromium per workspace, the per-chat Page map, the CDP screencast loop, the
// IPC socket the `claw-browser` shim talks to, and the pause/lock state.
//
// Process model (Phase 3):
//   - We launch Chromium ourselves via playwright-core's launchPersistentContext
//     so we own the user-data-dir and can attach CDP for screencast + input.
//   - We expose Chromium's CDP endpoint (ws://127.0.0.1:<port>) and pass it to
//     `playwright-cli` via the PLAYWRIGHT_CDP_ENDPOINT env var so the CLI
//     drives the same browser instead of spawning its own.
//   - For each chat, we own a Page (one tab) and a CDPSession that delivers
//     screencast frames; frames are throttled and broadcast over Socket.IO.
//   - Input takeover (Phase 4) and viewport switching (Phase 5) call into
//     Playwright's Page.mouse / Page.keyboard / setViewportSize on the same
//     page, so they stay in lockstep with whatever the agent is doing.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server as SocketIOServer } from 'socket.io';
import projectManager from './projectManager.ts';
import { isBrowserEnabled } from '../config.ts';
import type { BrowserViewportMode } from '../../shared/types/models.ts';

// playwright-core is bundled in server/package.json. We import dynamically so
// the module loads only when the browser feature is actually used (avoids
// pulling Chromium binaries into memory at boot).
type PlaywrightModule = typeof import('playwright-core');
type Browser = import('playwright-core').BrowserContext;
type Page = import('playwright-core').Page;
type CDPSession = import('playwright-core').CDPSession;

let playwrightMod: PlaywrightModule | null = null;
async function loadPlaywright(): Promise<PlaywrightModule> {
  if (!playwrightMod) {
    playwrightMod = await import('playwright-core');
  }
  return playwrightMod;
}

// --- Viewport descriptors -------------------------------------------------

interface ViewportDescriptor {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent?: string;
}

const VIEWPORTS: Record<BrowserViewportMode, ViewportDescriptor> = {
  desktop: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  tablet: {
    width: 1024,
    height: 768,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  mobile: {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};

// --- IPC + workspace state ------------------------------------------------

interface ExecMessage {
  type: 'exec';
  projectId: string;
  chatId: string;
  tabId: string | null;
  argv: string[];
  cwd: string;
}

interface PageEntry {
  page: Page;
  cdp: CDPSession;
  viewport: BrowserViewportMode;
  /** Throttle: timestamp of last broadcast frame (ms). */
  lastFrameAt: number;
  /** Last time an agent CLI command landed on this tab (ms epoch).
   *  Used to keep the popover's "driving" indicator green between
   *  commands even when the page is static and emits no frames. */
  lastCommandAt: number;
  /** Owning chat for chat-bound tabs; undefined for manual tabs. A chat
   *  can own multiple entries (multi-tab-per-chat). */
  chatId?: string;
  /** Order within the chat's tabs (1-based). Used to build the tabId and
   *  to display "Tab #N" in the popover. Undefined for manual tabs. */
  sequence?: number;
  /** Optional human-readable label (manual tabs only). */
  label?: string;
}

interface WorkspaceState {
  projectId: string;
  cliSession: string;
  /** Cached promise so concurrent callers wait on the same launch. */
  contextPromise: Promise<Browser> | null;
  /** CDP debugging port we asked Chromium to listen on (random per workspace). */
  cdpPort: number | null;
  /** Cached promise for the CDP endpoint URL (resolved from /json/version). */
  cdpEndpointPromise: Promise<string> | null;
  /** Chats whose tab is currently in user-takeover. While in this set, the
   *  shim's exec path returns "paused" and the agent stops issuing browser
   *  commands for that chat. Other chats in the same workspace are unaffected. */
  pausedChats: Set<string>;
  /** Per-chat input lock holder (socket id). Used when more than one client
   *  is viewing a chat's tab — only the lock holder's mouse/keys dispatch. */
  lockHolders: Map<string, string>;
  /** Per-chat tab state. */
  tabs: Map<string, PageEntry>;
  /** Per-chat active takeover id (set on pause, cleared on resume). */
  takeovers: Map<string, string>;
  /** Chat whose CLI command is currently mid-flight. The page-watcher uses
   *  this to attribute newly-created daemon pages to the right chat —
   *  otherwise concurrent chats would race for the same new page. */
  activeChatId: string | null;
  /** Single-flight queue: only one playwright-cli child runs at a time per workspace. */
  queue: Array<() => void>;
  active: boolean;
}

const workspaces = new Map<string, WorkspaceState>();
const servers = new Map<string, net.Server>();
let io: SocketIOServer | null = null;

// Frame target rate ~10 fps; tweakable.
const FRAME_INTERVAL_MS = 100;
const FRAME_QUALITY = 60; // JPEG 0-100

// Absolute path to the real playwright-cli binary. We resolve it once at
// module load so our spawn calls never go through PATH — server/bin/ on
// PATH contains our own playwright-cli shim, which would otherwise loop
// back into this manager and deadlock.
const REAL_PLAYWRIGHT_CLI = (() => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.join(here, '..', 'node_modules', '.bin', 'playwright-cli');
})();

// --- Filesystem layout ----------------------------------------------------

function getDataRoot(): string {
  if (process.env.CLAW_DESKTOP === '1') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'com.claw-dev.desktop', 'data');
  }
  return path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
}

export function userDataDirFor(projectId: string): string {
  const dir = path.join(getDataRoot(), 'browser-profiles', projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function socketPathFor(projectId: string): string {
  return path.join(os.tmpdir(), `claw-browser-${projectId}.sock`);
}

// --- Workspace bootstrap --------------------------------------------------

function getOrCreateWorkspace(projectId: string): WorkspaceState {
  let ws = workspaces.get(projectId);
  if (!ws) {
    ws = {
      projectId,
      cliSession: `workspace_${projectId}`,
      contextPromise: null,
      cdpPort: null,
      cdpEndpointPromise: null,
      pausedChats: new Set<string>(),
      lockHolders: new Map<string, string>(),
      tabs: new Map(),
      takeovers: new Map(),
      activeChatId: null,
      queue: [],
      active: false,
    };
    workspaces.set(projectId, ws);
  }
  return ws;
}

/** Pick a random ephemeral port for CDP (avoids collisions across workspaces). */
function pickPort(): number {
  // 49152-65535 is the IANA dynamic range. Random + collision-tolerant: if it's
  // taken Chromium will fail to bind and we'll regenerate next attempt.
  return 49152 + Math.floor(Math.random() * (65535 - 49152));
}

async function launchContext(ws: WorkspaceState): Promise<Browser> {
  const pw = await loadPlaywright();
  const port = pickPort();
  ws.cdpPort = port;
  const userDataDir = userDataDirFor(ws.projectId);

  // Persistent context preserves cookies/localStorage across restarts —
  // the user's "real" Chromium for this workspace.
  // Headless: the dashboard renders the screencast as the canonical view.
  // A headed window would pop up alongside the dashboard mirror, which is
  // confusing and out of scope for the panel UX.
  const context = await pw.chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: VIEWPORTS.desktop.width, height: VIEWPORTS.desktop.height },
    deviceScaleFactor: 1,
  });

  context.on('close', () => {
    // Chromium quit (user closed the window, crash, etc.) — drop our state so
    // the next exec lazily relaunches.
    ws.contextPromise = null;
    ws.cdpEndpointPromise = null;
    ws.tabs.clear();
    console.log(`[playwright:${ws.projectId}] Chromium closed; will relaunch on next command`);
  });

  console.log(`[playwright:${ws.projectId}] Chromium launched, CDP on :${port}`);
  return context;
}

/**
 * Idempotently ensure that .playwright-cli/.gitignore exists in the project,
 * so the runtime artifacts the CLI writes (snapshots, screenshots, logs)
 * don't appear in `git status` even for projects whose Browser toggle was
 * flipped on before we shipped nested gitignores. Cheap & safe to call on
 * every exec.
 */
function ensurePlaywrightCliGitignore(projectPath: string): void {
  const dir = path.join(projectPath, '.playwright-cli');
  const file = path.join(dir, '.gitignore');
  try {
    if (fs.existsSync(file)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      '# Runtime artifacts written by playwright-cli (snapshots, screenshots,\n' +
      '# console logs, videos). Never commit these.\n' +
      '# Ignore everything in this directory except this file itself.\n' +
      '*\n!.gitignore\n',
    );
  } catch { /* ignore — best effort */ }
}

async function ensureContext(ws: WorkspaceState): Promise<Browser> {
  if (!ws.contextPromise) {
    ws.contextPromise = launchContext(ws).catch((err) => {
      ws.contextPromise = null;
      throw err;
    });
    // Once Chromium is up, watch for new pages so we can retarget chat-tab
    // screencasts to whichever page playwright-cli's daemon navigates.
    startContextPageWatcher(ws);
  }
  return ws.contextPromise;
}

/** Resolve Chromium's CDP browser-level WebSocket URL by hitting /json/version. */
async function resolveCdpEndpoint(ws: WorkspaceState): Promise<string> {
  if (ws.cdpEndpointPromise) return ws.cdpEndpointPromise;
  ws.cdpEndpointPromise = (async () => {
    if (!ws.cdpPort) throw new Error('CDP port not assigned');
    // Retry briefly while Chromium is still warming up.
    const deadline = Date.now() + 5000;
    let lastErr: any = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${ws.cdpPort}/json/version`);
        if (res.ok) {
          const json = await res.json() as { webSocketDebuggerUrl: string };
          if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
        }
      } catch (err) {
        lastErr = err;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`CDP endpoint unreachable on port ${ws.cdpPort}: ${lastErr?.message || 'timeout'}`);
  })().catch((err) => {
    ws.cdpEndpointPromise = null;
    throw err;
  });
  return ws.cdpEndpointPromise;
}

// --- Per-tab + screencast -------------------------------------------------

/**
 * Tabs are addressed by an opaque tabId string. Two flavours:
 *   - Chat-bound tabs: tabId === chatId (legacy/back-compat).
 *   - Manual (user-created) tabs: tabId starts with `manual_`.
 *
 * All frames broadcast to the unified `project:${projectId}` Socket.IO room,
 * with `tabId` in the payload so the popover/dialog can route per-tab.
 */
export function isManualTab(tabId: string): boolean {
  return tabId.startsWith('manual_');
}

/** Wire up CDP screencast + URL/close event handlers for a Page that's
 *  now owned by `tabId`. Used both by initial-tab creation and by the
 *  page-watcher when the daemon spawns additional tabs. */
async function attachTabEntry(
  ws: WorkspaceState,
  tabId: string,
  page: Page,
  meta: { chatId?: string; sequence?: number; label?: string; viewport?: BrowserViewportMode },
): Promise<PageEntry> {
  const context = await ensureContext(ws);
  const viewport = meta.viewport ?? 'desktop';
  await applyViewport(page, viewport);

  const cdp = await context.newCDPSession(page);
  const entry: PageEntry = {
    page, cdp, viewport,
    lastFrameAt: 0,
    lastCommandAt: 0,
    chatId: meta.chatId,
    sequence: meta.sequence,
    label: meta.label,
  };
  ws.tabs.set(tabId, entry);

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: FRAME_QUALITY,
    everyNthFrame: 1,
  });
  cdp.on('Page.screencastFrame', (params: any) => {
    const now = Date.now();
    const tab = ws.tabs.get(tabId);
    if (tab && now - tab.lastFrameAt >= FRAME_INTERVAL_MS) {
      tab.lastFrameAt = now;
      io?.to(`project:${ws.projectId}`).emit('project:browser-frame', {
        projectId: ws.projectId,
        tabId,
        frame: params.data,
        width: params.metadata?.deviceWidth || VIEWPORTS[tab.viewport].width,
        height: params.metadata?.deviceHeight || VIEWPORTS[tab.viewport].height,
        ts: now,
        viewportMode: tab.viewport,
      });
    }
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });

  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      io?.to(`project:${ws.projectId}`).emit('project:browser-url', {
        projectId: ws.projectId,
        tabId,
        url,
      });
    }
  });

  page.on('close', () => {
    ws.tabs.delete(tabId);
    io?.to(`project:${ws.projectId}`).emit('project:browser-tab-closed', {
      projectId: ws.projectId,
      tabId,
    });
  });

  return entry;
}

/** Highest existing sequence number for a chat's tabs. Returns 0 if none. */
function maxSequenceForChat(ws: WorkspaceState, chatId: string): number {
  let max = 0;
  for (const e of ws.tabs.values()) {
    if (e.chatId === chatId && (e.sequence ?? 0) > max) max = e.sequence ?? 0;
  }
  return max;
}

/** Ensure a chat has at least one tab. Idempotent: returns the chat's
 *  most recent tab if any exist. Adopts orphan pages from the context
 *  if present (the daemon may have created one before we got here),
 *  otherwise creates a fresh blank page. */
async function ensureChatHasFirstTab(ws: WorkspaceState, chatId: string): Promise<PageEntry> {
  // Already has a live tab?
  for (const e of ws.tabs.values()) {
    if (e.chatId === chatId && !e.page.isClosed()) return e;
  }
  const context = await ensureContext(ws);
  // Adopt orphan page if any (daemon created one before we attached).
  const owned = new Set<unknown>();
  for (const e of ws.tabs.values()) owned.add(e.page);
  const orphans = context.pages().filter(p => !p.isClosed() && !owned.has(p));
  const page = orphans.length === 1 ? orphans[0] : await context.newPage();
  const sequence = 1;
  const tabId = `chat_${chatId}_${sequence}`;
  return attachTabEntry(ws, tabId, page, { chatId, sequence });
}

/** Ensure a manual (user-created) tab is wired up. Idempotent. */
async function ensureManualTab(ws: WorkspaceState, tabId: string, label?: string): Promise<PageEntry> {
  const existing = ws.tabs.get(tabId);
  if (existing && !existing.page.isClosed()) return existing;
  const context = await ensureContext(ws);
  const owned = new Set<unknown>();
  for (const e of ws.tabs.values()) owned.add(e.page);
  const orphans = context.pages().filter(p => !p.isClosed() && !owned.has(p));
  const page = orphans.length === 1 ? orphans[0] : await context.newPage();
  return attachTabEntry(ws, tabId, page, { label });
}

async function applyViewport(page: Page, mode: BrowserViewportMode): Promise<void> {
  const v = VIEWPORTS[mode];
  await page.setViewportSize({ width: v.width, height: v.height });
  if (v.userAgent) {
    // setExtraHTTPHeaders alone won't change UA reliably; using context-level
    // routing is heavier. For Phase 3 we accept that UA changes only apply on
    // the next navigation in this tab, which is the common case.
    try { await (page.context() as any).setExtraHTTPHeaders({ 'User-Agent': v.userAgent }); } catch { /* ignore */ }
  }
}

export async function setViewportForChat(
  projectId: string,
  chatId: string,
  mode: BrowserViewportMode,
): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  // Apply viewport to EVERY live tab owned by this chat — the agent's
  // command targets the daemon's "current" tab which we can't introspect
  // cheaply, so we set it on all of the chat's tabs.
  const entries = [...ws.tabs.values()].filter(e => e.chatId === chatId && !e.page.isClosed());
  if (entries.length === 0) {
    const first = await ensureChatHasFirstTab(ws, chatId);
    entries.push(first);
  }
  for (const e of entries) {
    await applyViewport(e.page, mode);
    e.viewport = mode;
  }
}

// --- CLI exec (agent commands) -------------------------------------------

function cliEnvFor(ws: WorkspaceState, cdpEndpoint: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PLAYWRIGHT_CLI_SESSION: ws.cliSession,
    // Tell playwright-cli's daemon to connect to OUR Chromium via CDP rather
    // than launching its own. Found in playwright-core's mcp/config.js:
    //   options.cdpEndpoint = envToString(e.PLAYWRIGHT_MCP_CDP_ENDPOINT)
    PLAYWRIGHT_MCP_CDP_ENDPOINT: cdpEndpoint,
  };
}

/**
 * playwright-cli's daemon listens on a unix socket under the system tmpdir.
 * When the daemon crashes / is killed without cleanup, the socket file
 * lingers and the next launch fails with EADDRINUSE. Sweep stale sockets
 * for our session name before each spawn so the agent doesn't have to dig
 * through /var/folders. We probe each candidate socket with a quick
 * non-blocking connect; if nothing answers, the file is orphaned and we
 * unlink it.
 */
async function sweepStaleDaemonSockets(sessionName: string): Promise<void> {
  // Daemon paths live at /var/folders/.../T/pw-*/cli/*-<session>.sock on macOS,
  // or $TMPDIR/pw-*/cli/*-<session>.sock more generically.
  const tmp = os.tmpdir();
  let pwDirs: string[] = [];
  try {
    pwDirs = fs.readdirSync(tmp).filter(d => d.startsWith('pw-')).map(d => path.join(tmp, d, 'cli'));
  } catch { return; }
  for (const dir of pwDirs) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      // Match sockets for OUR session name. The hash prefix changes per
      // tmp dir; the suffix is the session name.
      if (!name.endsWith(`-${sessionName}.sock`) && !name.endsWith(`-${sessionName}`)) continue;
      const full = path.join(dir, name);
      // Probe — if a daemon answers, leave it alone.
      const alive = await new Promise<boolean>((resolve) => {
        const c = net.createConnection({ path: full });
        const t = setTimeout(() => { c.destroy(); resolve(false); }, 100);
        c.once('connect', () => { clearTimeout(t); c.destroy(); resolve(true); });
        c.once('error', () => { clearTimeout(t); resolve(false); });
      });
      if (!alive) {
        try { fs.unlinkSync(full); } catch { /* ignore */ }
      }
    }
  }
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  conn: net.Socket,
): Promise<number> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(REAL_PLAYWRIGHT_CLI, args, { cwd, env });
    } catch (err: any) {
      conn.write(JSON.stringify({ type: 'error', message: `spawn failed: ${err?.message || err}`, code: 127 }) + '\n');
      resolve(127);
      return;
    }
    child.stdout?.on('data', (d) => {
      conn.write(JSON.stringify({ type: 'stdout', data: d.toString('utf8') }) + '\n');
    });
    child.stderr?.on('data', (d) => {
      conn.write(JSON.stringify({ type: 'stderr', data: d.toString('utf8') }) + '\n');
    });
    child.on('error', (err: any) => {
      conn.write(JSON.stringify({ type: 'error', message: err?.message || String(err), code: 127 }) + '\n');
      resolve(127);
    });
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

/**
 * Watch the workspace context for newly-created pages. When the daemon adds
 * a page (e.g. on `open <url>`), retarget the chat's screencast to the
 * latest page so the user sees what the agent navigated to instead of the
 * stale blank one we may have created first.
 */
function startContextPageWatcher(ws: WorkspaceState): void {
  if (ws.contextPromise === null) return;
  ws.contextPromise.then((context) => {
    if (!context) return;
    context.on('page', async (page) => {
      console.log(`[playwright:${ws.projectId}] new page in context`);
      const activeChat = ws.activeChatId;
      if (!activeChat) {
        // No CLI in-flight — leave the page floating; ensureManualTab will
        // adopt it as an orphan on its next call if needed.
        return;
      }
      // Find this chat's existing tabs.
      const chatEntries = [...ws.tabs.entries()].filter(([, e]) => e.chatId === activeChat);
      // If the chat has a placeholder (blank or dead) tab, retarget it —
      // this is the initial-open case where we pre-created a blank page
      // and the daemon now has the real one.
      const placeholder = chatEntries.find(([, e]) => e.page.isClosed() || e.page.url() === 'about:blank');
      if (placeholder) {
        console.log(`[playwright:${ws.projectId}] retargeting ${placeholder[0]} to new page`);
        await retargetTab(ws, placeholder[0], page);
        return;
      }
      // Otherwise this is a tab-new (or `open` while chat already has live
      // tabs) — add a fresh tab entry for the chat.
      const sequence = maxSequenceForChat(ws, activeChat) + 1;
      const tabId = `chat_${activeChat}_${sequence}`;
      console.log(`[playwright:${ws.projectId}] adding tab ${tabId}`);
      await attachTabEntry(ws, tabId, page, { chatId: activeChat, sequence });
      io?.to(`project:${ws.projectId}`).emit('project:browser-tab-created', {
        projectId: ws.projectId,
        tabId,
        label: null,
        url: page.url(),
      });
    });
  }).catch(() => { /* ignore */ });
}

/** Replace the Page object for an existing tab. Used by the page-watcher
 *  when a chat's initial placeholder tab needs to be swapped for the
 *  daemon's real page on the first `open`. */
async function retargetTab(ws: WorkspaceState, tabId: string, newPage: Page): Promise<void> {
  const old = ws.tabs.get(tabId);
  if (old) {
    try { await old.cdp.detach(); } catch { /* ignore */ }
  }
  ws.tabs.delete(tabId);
  await attachTabEntry(ws, tabId, newPage, {
    chatId: old?.chatId,
    sequence: old?.sequence,
    label: old?.label,
    viewport: old?.viewport,
  });
}

async function execOnWorkspace(
  ws: WorkspaceState,
  msg: ExecMessage,
  conn: net.Socket,
): Promise<void> {
  if (ws.active) await new Promise<void>((r) => ws.queue.push(r));
  ws.active = true;

  try {
    if (msg.chatId && ws.pausedChats.has(msg.chatId)) {
      conn.write(JSON.stringify({
        type: 'stderr',
        data: 'playwright-cli: paused — the user has taken over this tab. Stop issuing browser commands for this chat until you receive a takeover summary message.\n',
      }) + '\n');
      conn.write(JSON.stringify({ type: 'exit', code: 4 }) + '\n');
      return;
    }

    // Handle viewport command in-process (it needs Playwright API, not CLI).
    if (msg.argv[0] === 'viewport' && (msg.argv[1] === 'desktop' || msg.argv[1] === 'tablet' || msg.argv[1] === 'mobile')) {
      try {
        await setViewportForChat(ws.projectId, msg.chatId, msg.argv[1] as BrowserViewportMode);
        conn.write(JSON.stringify({ type: 'stdout', data: `viewport set to ${msg.argv[1]}\n` }) + '\n');
        conn.write(JSON.stringify({ type: 'exit', code: 0 }) + '\n');
      } catch (err: any) {
        conn.write(JSON.stringify({ type: 'stderr', data: `viewport set failed: ${err?.message || err}\n` }) + '\n');
        conn.write(JSON.stringify({ type: 'exit', code: 1 }) + '\n');
      }
      return;
    }

    // Make sure the chat has at least one tab; the page-watcher adds more
    // as the daemon does `tab-new`.
    let cdpEndpoint: string;
    try {
      if (msg.chatId) await ensureChatHasFirstTab(ws, msg.chatId);
      cdpEndpoint = await resolveCdpEndpoint(ws);
    } catch (err: any) {
      conn.write(JSON.stringify({ type: 'stderr', data: `playwright-cli: cannot start Chromium: ${err?.message || err}\n` }) + '\n');
      conn.write(JSON.stringify({ type: 'exit', code: 1 }) + '\n');
      return;
    }

    const env = cliEnvFor(ws, cdpEndpoint);
    const wantsPersistent = msg.argv[0] === 'open';
    const cliArgs = ['-s', ws.cliSession, ...(wantsPersistent ? ['--persistent'] : []), ...msg.argv];
    ws.activeChatId = msg.chatId;
    // Stamp every live tab of this chat so the "driving" indicator stays
    // green during command bursts — we don't know which specific tab the
    // daemon will target without round-tripping `tab-list`.
    const now = Date.now();
    for (const e of ws.tabs.values()) {
      if (e.chatId === msg.chatId) e.lastCommandAt = now;
    }
    ensurePlaywrightCliGitignore(msg.cwd);
    let code: number;
    try {
      await sweepStaleDaemonSockets(ws.cliSession);
      code = await runCli(cliArgs, env, msg.cwd, conn);
    } finally {
      ws.activeChatId = null;
    }
    conn.write(JSON.stringify({ type: 'exit', code }) + '\n');
  } finally {
    ws.active = false;
    const next = ws.queue.shift();
    if (next) next();
  }
}

/** In-process variant for SDK MCP calls — same serialization, no IPC. */
export async function execForChat(
  projectId: string,
  chatId: string,
  argv: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number; paused?: true }> {
  if (!isBrowserEnabled) {
    return { stdout: '', stderr: 'Browser automation is disabled (DASHBOARD_ENV=local required).\n', code: 5 };
  }
  const ws = getOrCreateWorkspace(projectId);
  if (ws.active) await new Promise<void>((r) => ws.queue.push(r));
  ws.active = true;
  try {
    if (ws.pausedChats.has(chatId)) {
      return {
        stdout: '',
        stderr: 'playwright-cli: paused — the user has taken over this tab. Stop issuing browser commands for this chat until you receive a takeover summary message.\n',
        code: 4,
        paused: true,
      };
    }

    if (argv[0] === 'viewport' && (argv[1] === 'desktop' || argv[1] === 'tablet' || argv[1] === 'mobile')) {
      await setViewportForChat(projectId, chatId, argv[1] as BrowserViewportMode);
      return { stdout: `viewport set to ${argv[1]}\n`, stderr: '', code: 0 };
    }

    await ensureChatHasFirstTab(ws, chatId);
    const cdpEndpoint = await resolveCdpEndpoint(ws);

    const env = cliEnvFor(ws, cdpEndpoint);
    const wantsPersistent = argv[0] === 'open';
    const cliArgs = ['-s', ws.cliSession, ...(wantsPersistent ? ['--persistent'] : []), ...argv];
    ws.activeChatId = chatId;
    const now = Date.now();
    for (const e of ws.tabs.values()) {
      if (e.chatId === chatId) e.lastCommandAt = now;
    }
    ensurePlaywrightCliGitignore(cwd);
    await sweepStaleDaemonSockets(ws.cliSession);
    try {
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        let stdout = '';
        let stderr = '';
        let child: ChildProcess;
        try {
          child = spawn(REAL_PLAYWRIGHT_CLI, cliArgs, { cwd, env });
        } catch (err: any) {
          resolve({ stdout: '', stderr: `spawn failed: ${err?.message || err}\n`, code: 127 });
          return;
        }
        child.stdout?.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr?.on('data', (d) => { stderr += d.toString('utf8'); });
        child.on('error', (err: any) => {
          resolve({ stdout, stderr: stderr + `error: ${err?.message || String(err)}\n`, code: 127 });
        });
        child.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
      });
    } finally {
      ws.activeChatId = null;
    }
  } finally {
    ws.active = false;
    const next = ws.queue.shift();
    if (next) next();
  }
}

// --- Pause + lock + state broadcast --------------------------------------

/** Resolve the chat owner for a given tab id. Returns null for manual tabs
 *  (no owner) or unknown tabs. Used by socket handlers to derive the chat
 *  scope from a tabId the viewer holds. */
export function chatOwnerOfTab(projectId: string, tabId: string): string | null {
  const ws = workspaces.get(projectId);
  return ws?.tabs.get(tabId)?.chatId ?? null;
}

/** Push the state for a specific tab to every project viewer. Carries both
 *  tabId (the lock/UI scope) and chatId (the pause scope, when applicable).
 *  Broadcasts on `project:${projectId}` — the unified browser room. */
function emitTabState(ws: WorkspaceState, tabId: string): void {
  if (!io) return;
  const entry = ws.tabs.get(tabId);
  const chatId = entry?.chatId;
  io.to(`project:${ws.projectId}`).emit('chat:browser-state', {
    projectId: ws.projectId,
    tabId,
    chatId: chatId ?? null,
    paused: chatId ? ws.pausedChats.has(chatId) : false,
    lockedBy: ws.lockHolders.get(tabId) ?? null,
  });
}

export function setChatPaused(projectId: string, chatId: string, paused: boolean): void {
  const ws = getOrCreateWorkspace(projectId);
  const was = ws.pausedChats.has(chatId);
  if (was === paused) return;
  if (paused) ws.pausedChats.add(chatId); else ws.pausedChats.delete(chatId);
  // Broadcast state for every tab of this chat so each open viewer
  // updates its banner.
  for (const [tabId, entry] of ws.tabs) {
    if (entry.chatId === chatId) emitTabState(ws, tabId);
  }
}

export function isChatPaused(projectId: string, chatId: string): boolean {
  return !!workspaces.get(projectId)?.pausedChats.has(chatId);
}

/** Per-tab input lock. Keyed by tabId (chat-bound or manual), independent
 *  of chat-level pause. */
export function acquireChatLock(projectId: string, tabId: string, socketId: string): { lockedBy: string | null; acquired: boolean } {
  const ws = getOrCreateWorkspace(projectId);
  const current = ws.lockHolders.get(tabId);
  if (current && current !== socketId) {
    return { lockedBy: current, acquired: false };
  }
  ws.lockHolders.set(tabId, socketId);
  emitTabState(ws, tabId);
  return { lockedBy: socketId, acquired: true };
}

export function releaseChatLock(projectId: string, tabId: string, socketId: string): void {
  const ws = getOrCreateWorkspace(projectId);
  if (ws.lockHolders.get(tabId) === socketId) {
    ws.lockHolders.delete(tabId);
    emitTabState(ws, tabId);
  }
}

// --- IPC server (claw-browser shim) ---------------------------------------

function handleConnection(conn: net.Socket): void {
  let buf = '';
  conn.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch {
        conn.write(JSON.stringify({ type: 'error', message: 'invalid JSON', code: 22 }) + '\n');
        conn.end();
        return;
      }
      if (msg.type === 'exec') {
        const ws = getOrCreateWorkspace(msg.projectId);
        execOnWorkspace(ws, msg as ExecMessage, conn).catch((err) => {
          conn.write(JSON.stringify({ type: 'error', message: err?.message || String(err), code: 1 }) + '\n');
          conn.end();
        });
      } else {
        conn.write(JSON.stringify({ type: 'error', message: `unknown message type: ${msg.type}`, code: 22 }) + '\n');
        conn.end();
      }
    }
  });
  conn.on('error', () => { /* shim will exit on its end */ });
}

export function ensureWorkspaceServer(projectId: string): void {
  if (!isBrowserEnabled) return;
  if (servers.has(projectId)) return;

  const sockPath = socketPathFor(projectId);
  try { fs.unlinkSync(sockPath); } catch { /* doesn't exist */ }

  const server = net.createServer(handleConnection);
  server.on('error', (err: any) => {
    console.error(`[playwright:${projectId}] socket server error:`, err?.message || err);
  });
  server.listen(sockPath, () => {
    try { fs.chmodSync(sockPath, 0o600); } catch { /* best effort */ }
    console.log(`[playwright:${projectId}] listening on ${sockPath}`);
  });
  servers.set(projectId, server);
  getOrCreateWorkspace(projectId);
}

// --- Input dispatch (Phase 4) --------------------------------------------

/**
 * Pick a short, agent-readable label for the element at (x, y) on the page.
 * Returns role + accessible name when possible (e.g. "button 'Sign in'");
 * falls back to tag + visible text + nearest input attrs.
 *
 * Runs inside the browser via page.evaluate, so it sees the live DOM the user
 * actually clicked. Best-effort — returns empty string on errors.
 */
async function describeElementAt(page: Page, x: number, y: number): Promise<string> {
  try {
    return await page.evaluate(({ x, y }: { x: number; y: number }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return '';
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const ariaLabel = el.getAttribute('aria-label')?.trim();
      const name = (el as HTMLInputElement).name;
      const placeholder = (el as HTMLInputElement).placeholder;
      const value = (el as HTMLInputElement).value;
      const id = el.id;
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const label = ariaLabel || (text && text.length < 60 ? text : '') || placeholder || name || id || '';
      return label ? `${role} "${label}"` : role;
    }, { x, y });
  } catch {
    return '';
  }
}

/** Build a short natural-language description for a takeover input event. */
function describeInput(ev: {
  kind: string; x?: number; y?: number; button?: string; deltaX?: number; deltaY?: number; key?: string; text?: string;
}, elementLabel?: string): string {
  switch (ev.kind) {
    case 'mouse-click': {
      const target = elementLabel || `(${Math.round(ev.x ?? 0)}, ${Math.round(ev.y ?? 0)})`;
      const btn = ev.button && ev.button !== 'left' ? `(${ev.button}-click) ` : '';
      return `${btn}Clicked ${target}`;
    }
    case 'mouse-wheel': {
      const dir = (ev.deltaY ?? 0) > 0 ? 'down' : 'up';
      return `Scrolled ${dir}`;
    }
    case 'key-down':
      return `Pressed ${ev.key}`;
    case 'type':
      return `Typed "${ev.text ?? ''}"`;
    // Drop mouse-move / mouse-down / mouse-up / key-up — they're high-noise,
    // low-signal events that bury the actually-meaningful actions in the log.
    default:
      return '';
  }
}

/** Begin a takeover for a chat — call when the user clicks Pause. */
export function beginTakeover(projectId: string, chatId: string): string {
  const ws = getOrCreateWorkspace(projectId);
  const id = `takeover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  ws.takeovers.set(chatId, id);
  return id;
}

/** Complete a takeover and return the natural-language event log. */
export function endTakeover(projectId: string, chatId: string): { takeoverId: string | null; descriptions: string[] } {
  const ws = getOrCreateWorkspace(projectId);
  const id = ws.takeovers.get(chatId) || null;
  ws.takeovers.delete(chatId);
  if (!id) return { takeoverId: null, descriptions: [] };
  const events = projectManager.listTakeoverEvents(chatId, id);

  // Collapse runs of consecutive 'type' events into a single line so the
  // agent sees `Typed "hello world"` instead of one entry per character.
  // Same for consecutive 'mouse-wheel' events — fold into "Scrolled".
  const out: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.eventType === 'type') {
      let combined = '';
      let j = i;
      while (j < events.length && events[j].eventType === 'type') {
        const m = /^Typed "(.*)"$/.exec(events[j].description);
        combined += m ? m[1] : '';
        j++;
      }
      if (combined) out.push(`Typed "${combined}"`);
      i = j - 1;
    } else if (e.eventType === 'mouse-wheel') {
      let j = i;
      while (j < events.length && events[j].eventType === 'mouse-wheel') j++;
      out.push('Scrolled the page');
      i = j - 1;
    } else {
      out.push(e.description);
    }
  }
  return { takeoverId: id, descriptions: out };
}

/**
 * Open or navigate a manual (user-created) tab. Lazily launches Chromium.
 * Chat-bound tabs are managed by the agent via playwright-cli; this path
 * is only for tabs the user creates from the popover's "+ Add tab".
 */
export async function openTab(projectId: string, tabId: string, url?: string): Promise<{ url: string }> {
  if (!isBrowserEnabled) throw new Error('Browser disabled in this environment');
  if (!isManualTab(tabId)) throw new Error('openTab only supports manual tabs');
  const ws = getOrCreateWorkspace(projectId);
  const entry = await ensureManualTab(ws, tabId);
  if (url) {
    try {
      await entry.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (err: any) {
      console.warn(`[playwright:${projectId}] tab ${tabId} goto failed: ${err?.message || err}`);
    }
  }
  return { url: entry.page.url() };
}

/** Set viewport mode for any specific tab (manual or chat-bound). */
export async function setTabViewport(
  projectId: string,
  tabId: string,
  mode: BrowserViewportMode,
): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  const entry = ws.tabs.get(tabId);
  if (!entry) return;
  await applyViewport(entry.page, mode);
  entry.viewport = mode;
}

/** Dispatch user input to any tab. No lock — only one user driving manually anyway. */
export async function dispatchTabInput(
  projectId: string,
  tabId: string,
  ev: {
    kind: 'mouse-move' | 'mouse-down' | 'mouse-up' | 'mouse-click' | 'mouse-wheel' | 'key-down' | 'key-up' | 'type';
    x?: number;
    y?: number;
    button?: 'left' | 'middle' | 'right';
    deltaX?: number;
    deltaY?: number;
    key?: string;
    text?: string;
  },
): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  const entry = ws.tabs.get(tabId);
  if (!entry) return;
  const { page } = entry;
  switch (ev.kind) {
    case 'mouse-move':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') await page.mouse.move(ev.x, ev.y);
      break;
    case 'mouse-down':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') await page.mouse.move(ev.x, ev.y);
      await page.mouse.down({ button: ev.button || 'left' });
      break;
    case 'mouse-up':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') await page.mouse.move(ev.x, ev.y);
      await page.mouse.up({ button: ev.button || 'left' });
      break;
    case 'mouse-click':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        await page.mouse.click(ev.x, ev.y, { button: ev.button || 'left' });
      }
      break;
    case 'mouse-wheel':
      await page.mouse.wheel(ev.deltaX || 0, ev.deltaY || 0);
      break;
    case 'key-down':
      if (ev.key) await page.keyboard.down(ev.key);
      break;
    case 'key-up':
      if (ev.key) await page.keyboard.up(ev.key);
      break;
    case 'type':
      if (ev.text) await page.keyboard.type(ev.text);
      break;
  }

  // Takeover logging — if this tab belongs to a chat that's currently in
  // takeover, record the user's action so the resume-summary can describe
  // it. Skipped for noisy events (mouse-move / raw mouse-down/up / key-up).
  if (entry.chatId) {
    const takeoverId = ws.takeovers.get(entry.chatId);
    if (takeoverId) {
      let label = '';
      if (ev.kind === 'mouse-click' && typeof ev.x === 'number' && typeof ev.y === 'number') {
        label = await describeElementAt(page, ev.x, ev.y);
      }
      const desc = describeInput(ev, label);
      if (desc) {
        try {
          projectManager.recordTakeoverEvent(entry.chatId, takeoverId, ev.kind, desc);
        } catch { /* ignore */ }
      }
    }
  }
}

/** Capture and broadcast a single frame for the given tab on demand. */
export async function refreshFrameForTab(projectId: string, tabId: string): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  const entry = ws.tabs.get(tabId);
  if (!entry) return;
  try {
    const buf = await entry.page.screenshot({ type: 'jpeg', quality: FRAME_QUALITY });
    const v = VIEWPORTS[entry.viewport];
    io?.to(`project:${projectId}`).emit('project:browser-frame', {
      projectId,
      tabId,
      frame: buf.toString('base64'),
      width: v.width,
      height: v.height,
      ts: Date.now(),
      viewportMode: entry.viewport,
    });
  } catch (err) {
    console.error(`[playwright:${projectId}] refresh-frame for ${tabId} failed:`, err);
  }
}

/** Close any tab. */
export async function closeTab(projectId: string, tabId: string): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  const entry = ws.tabs.get(tabId);
  if (entry) {
    try { await entry.cdp.detach(); } catch { /* ignore */ }
    try { await entry.page.close(); } catch { /* ignore */ }
    ws.tabs.delete(tabId);
  }
  // Also release any per-tab lock so a stuck disconnect doesn't leave a
  // ghost holder.
  ws.lockHolders.delete(tabId);
  io?.to(`project:${projectId}`).emit('project:browser-tab-closed', { projectId, tabId });
}

/**
 * Aggregated tab list for a project. ws.tabs is the single source of truth
 * now — tabs are pure runtime state, never persisted in the DB. The popover
 * groups by chat using the kind + chatId fields.
 */
export function listTabs(projectId: string): Array<{
  tabId: string;
  kind: 'chat' | 'manual';
  chatId?: string;
  /** Sequence within the owning chat (1, 2, …). Used to render "Tab #N". */
  sequence?: number;
  label: string;
  currentUrl: string | null;
  viewportMode: BrowserViewportMode;
  driving: boolean;
  alive: boolean;
}> {
  const ws = getOrCreateWorkspace(projectId);
  const now = Date.now();
  const drivingFor = (entry: PageEntry) =>
    now - entry.lastFrameAt < 1500 || now - entry.lastCommandAt < 6000;

  const out: Array<any> = [];
  for (const [tabId, entry] of ws.tabs) {
    if (entry.chatId) {
      const chat = projectManager.getChat(entry.chatId);
      const chatLabel = chat?.label || 'Chat';
      const seqSuffix = (entry.sequence ?? 0) > 1 ? ` · tab ${entry.sequence}` : '';
      out.push({
        tabId,
        kind: 'chat' as const,
        chatId: entry.chatId,
        sequence: entry.sequence,
        label: chatLabel + seqSuffix,
        currentUrl: safeUrl(entry.page),
        viewportMode: entry.viewport,
        driving: drivingFor(entry),
        alive: !entry.page.isClosed(),
      });
    } else {
      const url = safeUrl(entry.page);
      out.push({
        tabId,
        kind: 'manual' as const,
        label: entry.label || (url && url !== 'about:blank' ? hostFromUrl(url) : 'New tab'),
        currentUrl: url,
        viewportMode: entry.viewport,
        driving: drivingFor(entry),
        alive: !entry.page.isClosed(),
      });
    }
  }
  return out;
}

function safeUrl(page: Page): string | null {
  try {
    if (page.isClosed()) return null;
    const u = page.url();
    return u || null;
  } catch { return null; }
}

function hostFromUrl(u: string): string {
  try { return new URL(u).host || u; } catch { return u.slice(0, 40); }
}

/**
 * Reset the project's browser: cancel in-flight commands, close Chromium,
 * delete the persistent profile dir, drop tab rows. The next browser command
 * lazily launches fresh Chromium with no cookies/storage.
 */
export async function resetProjectBrowser(projectId: string): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  // Cancel any queued execs by clearing the queue (active one finishes naturally).
  ws.queue = [];
  ws.pausedChats.clear();
  ws.lockHolders.clear();
  ws.takeovers.clear();

  if (ws.contextPromise) {
    try {
      const ctx = await ws.contextPromise;
      await ctx.close();
    } catch { /* ignore */ }
  }
  ws.contextPromise = null;
  ws.cdpEndpointPromise = null;
  ws.tabs.clear();

  // Delete profile dir contents.
  const dir = userDataDirFor(projectId);
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.rmSync(p, { force: true });
    }
  } catch (err) {
    console.error(`[playwright:${projectId}] reset profile dir failed:`, err);
  }

  // Notify clients that browser state is gone.
  io?.to(`project:${projectId}`).emit('project:browser-reset', { projectId });
}

/**
 * Capture and broadcast a single frame for the chat's tab on demand.
 * CDP screencast only emits on visual changes — when the user opens the
 * BrowserArtifact dialog on a static page they'd otherwise see nothing
 * until something redraws. This pushes one screenshot immediately.
 */
export async function refreshFrameForChat(projectId: string, chatId: string): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  const entry = ws.tabs.get(chatId);
  if (!entry) return;
  try {
    const buf = await entry.page.screenshot({ type: 'jpeg', quality: FRAME_QUALITY });
    const v = VIEWPORTS[entry.viewport];
    io?.to(`claude:${chatId}`).emit('chat:browser-frame', {
      chatId,
      frame: buf.toString('base64'),
      width: v.width,
      height: v.height,
      ts: Date.now(),
      viewportMode: entry.viewport,
    });
  } catch (err) {
    console.error(`[playwright:${projectId}] refresh-frame failed:`, err);
  }
}

/** Get a fresh accessibility snapshot for the chat's tab — used in resume summaries. */
export async function snapshotForChat(projectId: string, chatId: string): Promise<string> {
  const result = await execForChat(projectId, chatId, ['snapshot'], userDataDirFor(projectId));
  if (result.code !== 0) {
    return `(snapshot failed, exit ${result.code})${result.stderr ? '\n' + result.stderr : ''}`;
  }
  return result.stdout || '(empty snapshot)';
}

/** Disconnect-cleanup: release every per-tab lock held by this socket so a
 *  disconnected viewer doesn't leave another client unable to take over. */
export function onSocketDisconnect(socketId: string): void {
  for (const ws of workspaces.values()) {
    for (const [tabId, holder] of ws.lockHolders) {
      if (holder === socketId) {
        ws.lockHolders.delete(tabId);
        emitTabState(ws, tabId);
      }
    }
  }
}

export function attachIO(server: SocketIOServer): void {
  io = server;
}

export async function shutdown(): Promise<void> {
  for (const [, ws] of workspaces) {
    if (ws.contextPromise) {
      try { (await ws.contextPromise).close(); } catch { /* ignore */ }
    }
  }
  for (const [id, server] of servers) {
    try { server.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(socketPathFor(id)); } catch { /* ignore */ }
  }
  servers.clear();
  workspaces.clear();
}

export default {
  ensureWorkspaceServer,
  execForChat,
  refreshFrameForChat,
  refreshFrameForTab,
  setChatPaused,
  isChatPaused,
  acquireChatLock,
  releaseChatLock,
  chatOwnerOfTab,
  dispatchTabInput,
  beginTakeover,
  endTakeover,
  snapshotForChat,
  setViewportForChat,
  setTabViewport,
  openTab,
  closeTab,
  listTabs,
  resetProjectBrowser,
  onSocketDisconnect,
  attachIO,
  shutdown,
  userDataDirFor,
  isManualTab,
};
