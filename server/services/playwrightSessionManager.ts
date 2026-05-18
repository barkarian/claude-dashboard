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
  paused: boolean;
  /** Socket id holding the input lock; null = no one. */
  lockedBy: string | null;
  /** Per-chat tab state. */
  tabs: Map<string, PageEntry>;
  /** Per-chat active takeover id (set on pause, cleared on resume). */
  takeovers: Map<string, string>;
  /** Tab whose CLI command is currently mid-flight. The page-watcher uses
   *  this to attribute newly-created daemon pages to the right tab —
   *  otherwise concurrent chats would race for the same new page. */
  activeTabId: string | null;
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
      paused: false,
      lockedBy: null,
      tabs: new Map(),
      takeovers: new Map(),
      activeTabId: null,
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

async function ensurePage(ws: WorkspaceState, tabId: string): Promise<PageEntry> {
  let entry = ws.tabs.get(tabId);
  if (entry && !entry.page.isClosed()) return entry;

  const context = await ensureContext(ws);
  // Each tab owns its own Page — never adopt a page that another tab in
  // ws.tabs already references, otherwise both tabs end up screencasting
  // the same Page and mirror each other.
  const ownedPages = new Set<unknown>();
  for (const e of ws.tabs.values()) ownedPages.add(e.page);
  const orphanPages = context.pages().filter(p => !p.isClosed() && !ownedPages.has(p));
  // If there's exactly one orphan page (e.g. the daemon just created one
  // in response to our `open` and we haven't claimed it yet), adopt it
  // for this tab. Otherwise create a fresh page so each chat tab gets
  // its own Chromium tab.
  const page = orphanPages.length === 1
    ? orphanPages[0]
    : await context.newPage();
  // Per-chat tabs persist their viewport in the DB; the project-level tab
  // defaults to desktop and isn't tracked there.
  const viewport: BrowserViewportMode = isManualTab(tabId)
    ? (projectManager.listManualTabs(ws.projectId).find(t => t.id === tabId)?.viewportMode) || 'desktop'
    : (projectManager.listBrowserTabsByProject(ws.projectId).find(t => t.chatId === tabId)?.viewportMode) || 'desktop';
  await applyViewport(page, viewport);

  const cdp = await context.newCDPSession(page);
  entry = { page, cdp, viewport, lastFrameAt: 0, lastCommandAt: 0 };
  ws.tabs.set(tabId, entry);

  // Start a CDP screencast — frames arrive as Page.screencastFrame events,
  // each must be acked or Chromium stops sending more.
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: FRAME_QUALITY,
    everyNthFrame: 1,
  });
  cdp.on('Page.screencastFrame', (params: any) => {
    // Throttle: enforce a server-side floor on broadcast rate.
    const now = Date.now();
    const tab = ws.tabs.get(tabId);
    if (tab && now - tab.lastFrameAt >= FRAME_INTERVAL_MS) {
      tab.lastFrameAt = now;
      // Single unified room per project — every browser viewer in the project
      // (popover, tab dialogs, mobile peer clients) lives in this room and
      // routes frames by tabId.
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
    // Ack regardless of broadcast — required by CDP protocol.
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });

  // Track URL changes — persist on the right table per kind, then push a
  // unified url event to the project room so the popover updates labels.
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      try {
        if (isManualTab(tabId)) {
          projectManager.updateManualTab(tabId, { currentUrl: url });
        } else {
          projectManager.updateBrowserTab(tabId, { currentUrl: url });
        }
      } catch { /* ignore */ }
      io?.to(`project:${ws.projectId}`).emit('project:browser-url', {
        projectId: ws.projectId,
        tabId,
        url,
      });
    }
  });

  page.on('close', () => {
    ws.tabs.delete(tabId);
  });

  return entry;
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
  const entry = await ensurePage(ws, chatId);
  await applyViewport(entry.page, mode);
  entry.viewport = mode;
  try { projectManager.updateBrowserTab(chatId, { viewportMode: mode }); } catch { /* ignore */ }
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
      // Attribute the new page to the tab whose CLI is currently running.
      // The queue in execOnWorkspace / execForChat ensures only one tab is
      // active at a time, so the activeTabId is unambiguous.
      const targetTabId = ws.activeTabId;
      if (!targetTabId) {
        // No CLI in-flight — leave the page floating; ensurePage will adopt
        // it as an orphan on its next call if needed.
        return;
      }
      const entry = ws.tabs.get(targetTabId);
      if (!entry) return;
      // Only retarget if our existing page is blank/dead. If we already
      // own a non-blank page for this tab, the daemon's new page is a
      // duplicate — don't switch.
      if (entry.page.isClosed() || entry.page.url() === 'about:blank') {
        console.log(`[playwright:${ws.projectId}] retargeting tab ${targetTabId} to new page`);
        await retargetTab(ws, targetTabId, page);
      }
    });
  }).catch(() => { /* ignore */ });
}

async function retargetTab(ws: WorkspaceState, tabId: string, newPage: Page): Promise<void> {
  const old = ws.tabs.get(tabId);
  // Stop the old screencast first (best-effort).
  if (old) {
    try { await old.cdp.detach(); } catch { /* ignore */ }
  }
  const context = await ensureContext(ws);
  const cdp = await context.newCDPSession(newPage);
  const viewport = old?.viewport || 'desktop';
  const entry: PageEntry = { page: newPage, cdp, viewport, lastFrameAt: 0, lastCommandAt: 0 };
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
  newPage.on('close', () => { ws.tabs.delete(tabId); });
}

async function execOnWorkspace(
  ws: WorkspaceState,
  msg: ExecMessage,
  conn: net.Socket,
): Promise<void> {
  if (ws.active) await new Promise<void>((r) => ws.queue.push(r));
  ws.active = true;

  try {
    if (ws.paused) {
      conn.write(JSON.stringify({
        type: 'stderr',
        data: 'claw-browser: workspace paused — user has control.\n',
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

    if (msg.chatId) {
      projectManager.getOrCreateBrowserTab(msg.chatId, ws.projectId);
    }

    // Make sure we have a Page (and screencast) for this chat before forwarding
    // commands — the CLI will operate on whatever tab is active in CDP, so the
    // page we created becomes that tab.
    let cdpEndpoint: string;
    try {
      await ensurePage(ws, msg.chatId);
      cdpEndpoint = await resolveCdpEndpoint(ws);
    } catch (err: any) {
      conn.write(JSON.stringify({ type: 'stderr', data: `claw-browser: cannot start Chromium: ${err?.message || err}\n` }) + '\n');
      conn.write(JSON.stringify({ type: 'exit', code: 1 }) + '\n');
      return;
    }

    const env = cliEnvFor(ws, cdpEndpoint);
    const wantsPersistent = msg.argv[0] === 'open';
    const cliArgs = ['-s', ws.cliSession, ...(wantsPersistent ? ['--persistent'] : []), ...msg.argv];
    ws.activeTabId = msg.chatId;
    const entryForStamp = ws.tabs.get(msg.chatId);
    if (entryForStamp) entryForStamp.lastCommandAt = Date.now();
    ensurePlaywrightCliGitignore(msg.cwd);
    let code: number;
    try {
      // Sweep stale daemon sockets so EADDRINUSE doesn't bubble up to the agent.
      await sweepStaleDaemonSockets(ws.cliSession);
      code = await runCli(cliArgs, env, msg.cwd, conn);
    } finally {
      ws.activeTabId = null;
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
    if (ws.paused) {
      return { stdout: '', stderr: 'claw-browser: workspace paused — user has control.\n', code: 4, paused: true };
    }

    if (argv[0] === 'viewport' && (argv[1] === 'desktop' || argv[1] === 'tablet' || argv[1] === 'mobile')) {
      await setViewportForChat(projectId, chatId, argv[1] as BrowserViewportMode);
      return { stdout: `viewport set to ${argv[1]}\n`, stderr: '', code: 0 };
    }

    projectManager.getOrCreateBrowserTab(chatId, projectId);
    await ensurePage(ws, chatId);
    const cdpEndpoint = await resolveCdpEndpoint(ws);

    const env = cliEnvFor(ws, cdpEndpoint);
    const wantsPersistent = argv[0] === 'open';
    const cliArgs = ['-s', ws.cliSession, ...(wantsPersistent ? ['--persistent'] : []), ...argv];
    ws.activeTabId = chatId;
    const entryForStamp = ws.tabs.get(chatId);
    if (entryForStamp) entryForStamp.lastCommandAt = Date.now();
    ensurePlaywrightCliGitignore(cwd);
    // Sweep stale daemon sockets so EADDRINUSE doesn't bubble up to the agent.
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
      ws.activeTabId = null;
    }
  } finally {
    ws.active = false;
    const next = ws.queue.shift();
    if (next) next();
  }
}

// --- Pause + lock + state broadcast --------------------------------------

function emitState(ws: WorkspaceState, chatId?: string): void {
  if (!io) return;
  // We broadcast per-chat because the artifact UI listens at the chat level.
  const targets = chatId ? [chatId] : Array.from(ws.tabs.keys());
  for (const cid of targets) {
    io.to(`claude:${cid}`).emit('chat:browser-state', {
      chatId: cid,
      paused: ws.paused,
      lockedBy: ws.lockedBy,
    });
  }
}

export function setPaused(projectId: string, paused: boolean): void {
  const ws = getOrCreateWorkspace(projectId);
  if (ws.paused === paused) return;
  ws.paused = paused;
  emitState(ws);
}

export function isPaused(projectId: string): boolean {
  return !!workspaces.get(projectId)?.paused;
}

/** Try to acquire the input lock. Returns the lock holder after the call. */
export function acquireLock(projectId: string, socketId: string): { lockedBy: string | null; acquired: boolean } {
  const ws = getOrCreateWorkspace(projectId);
  if (ws.lockedBy && ws.lockedBy !== socketId) {
    return { lockedBy: ws.lockedBy, acquired: false };
  }
  ws.lockedBy = socketId;
  emitState(ws);
  return { lockedBy: socketId, acquired: true };
}

export function releaseLock(projectId: string, socketId: string): void {
  const ws = getOrCreateWorkspace(projectId);
  if (ws.lockedBy === socketId) {
    ws.lockedBy = null;
    emitState(ws);
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

/** Dispatch a user input event to the chat's tab. Caller must hold the lock. */
export async function dispatchInput(
  projectId: string,
  chatId: string,
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
  const entry = ws.tabs.get(chatId);
  if (!entry) return; // No tab yet — nothing to dispatch to.
  const { page } = entry;
  switch (ev.kind) {
    case 'mouse-move':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        await page.mouse.move(ev.x, ev.y);
      }
      break;
    case 'mouse-down':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        await page.mouse.move(ev.x, ev.y);
      }
      await page.mouse.down({ button: ev.button || 'left' });
      break;
    case 'mouse-up':
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        await page.mouse.move(ev.x, ev.y);
      }
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

  // If the workspace is paused (i.e. the user is in takeover), append this
  // event to the takeover log so we can summarize on resume. Skip noisy
  // events whose description is empty (mouse-move, raw down/up, key-up).
  const takeoverId = ws.takeovers.get(chatId);
  if (takeoverId) {
    let label = '';
    if (ev.kind === 'mouse-click' && typeof ev.x === 'number' && typeof ev.y === 'number') {
      label = await describeElementAt(page, ev.x, ev.y);
    }
    const desc = describeInput(ev, label);
    if (desc) {
      try {
        projectManager.recordTakeoverEvent(chatId, takeoverId, ev.kind, desc);
      } catch { /* ignore */ }
    }
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
 * Open or navigate any tab (manual or chat-bound). Lazily launches Chromium.
 * Returns the current URL after the operation completes.
 */
export async function openTab(projectId: string, tabId: string, url?: string): Promise<{ url: string }> {
  if (!isBrowserEnabled) throw new Error('Browser disabled in this environment');
  const ws = getOrCreateWorkspace(projectId);
  ws.activeTabId = tabId;
  try {
    const entry = await ensurePage(ws, tabId);
    if (url) {
      try {
        await entry.page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (err: any) {
        console.warn(`[playwright:${projectId}] tab ${tabId} goto failed: ${err?.message || err}`);
      }
    }
    return { url: entry.page.url() };
  } finally {
    ws.activeTabId = null;
  }
}

/** Set viewport mode for any tab. */
export async function setTabViewport(
  projectId: string,
  tabId: string,
  mode: BrowserViewportMode,
): Promise<void> {
  const ws = getOrCreateWorkspace(projectId);
  const entry = await ensurePage(ws, tabId);
  await applyViewport(entry.page, mode);
  entry.viewport = mode;
  try {
    if (isManualTab(tabId)) {
      projectManager.updateManualTab(tabId, { viewportMode: mode });
    } else {
      projectManager.updateBrowserTab(tabId, { viewportMode: mode });
    }
  } catch { /* ignore */ }
}

/** Dispatch user input to any tab. No lock — only one user driving manually anyway. */
export async function dispatchTabInput(
  projectId: string,
  tabId: string,
  ev: Parameters<typeof dispatchInput>[2],
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
  // Clean up the persistent row so the tab doesn't reappear in the popover
  // — it's gone, not "closed". A new one will be created lazily next time.
  try {
    if (isManualTab(tabId)) {
      projectManager.deleteManualTab(tabId);
    } else {
      projectManager.deleteBrowserTab(tabId);
    }
  } catch { /* ignore */ }
  io?.to(`project:${projectId}`).emit('project:browser-tab-closed', { projectId, tabId });
}

/**
 * Aggregated tab list for a project — chat-bound tabs from chat_browser_tabs
 * plus manual tabs from manual_browser_tabs. Each entry is enriched with
 * liveness + driving from in-memory state.
 */
export function listTabs(projectId: string): Array<{
  tabId: string;
  kind: 'chat' | 'manual';
  chatId?: string;
  label: string;
  currentUrl: string | null;
  viewportMode: BrowserViewportMode;
  driving: boolean;
  alive: boolean;
}> {
  const ws = getOrCreateWorkspace(projectId);
  const now = Date.now();
  const out: Array<any> = [];
  // Use the longer of {recent frame, recent command} as the "driving"
  // signal. Frames cover live visual changes; command activity covers
  // periods where the agent is interacting but the page is static and
  // emits no frames (lots of clicks/typing on a quiet page).
  const drivingFor = (entry?: PageEntry) => {
    if (!entry) return false;
    return now - entry.lastFrameAt < 1500 || now - entry.lastCommandAt < 6000;
  };
  // Chat-bound tabs.
  for (const t of projectManager.listBrowserTabsByProject(projectId)) {
    const entry = ws.tabs.get(t.chatId);
    const chat = projectManager.getChat(t.chatId);
    out.push({
      tabId: t.chatId,
      kind: 'chat' as const,
      chatId: t.chatId,
      label: chat?.label || 'Chat',
      currentUrl: t.currentUrl,
      viewportMode: t.viewportMode,
      driving: drivingFor(entry),
      alive: !!entry && !entry.page.isClosed(),
    });
  }
  // Manual tabs.
  for (const t of projectManager.listManualTabs(projectId)) {
    const entry = ws.tabs.get(t.id);
    out.push({
      tabId: t.id,
      kind: 'manual' as const,
      label: t.label || (t.currentUrl ? hostFromUrl(t.currentUrl) : 'New tab'),
      currentUrl: t.currentUrl,
      viewportMode: t.viewportMode,
      driving: drivingFor(entry),
      alive: !!entry && !entry.page.isClosed(),
    });
  }
  return out;
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
  ws.paused = false;
  ws.lockedBy = null;
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

/** Disconnect-cleanup: drop input lock if it was held by this socket. */
export function onSocketDisconnect(socketId: string): void {
  for (const ws of workspaces.values()) {
    if (ws.lockedBy === socketId) {
      ws.lockedBy = null;
      emitState(ws);
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
  setPaused,
  isPaused,
  acquireLock,
  releaseLock,
  dispatchInput,
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
