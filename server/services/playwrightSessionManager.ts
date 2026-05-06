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
  const context = await pw.chromium.launchPersistentContext(userDataDir, {
    headless: false, // we want a real Chromium so the agent can do real work
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

async function ensureContext(ws: WorkspaceState): Promise<Browser> {
  if (!ws.contextPromise) {
    ws.contextPromise = launchContext(ws).catch((err) => {
      ws.contextPromise = null;
      throw err;
    });
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

async function ensurePage(ws: WorkspaceState, chatId: string): Promise<PageEntry> {
  let entry = ws.tabs.get(chatId);
  if (entry && !entry.page.isClosed()) return entry;

  const context = await ensureContext(ws);
  const page = await context.newPage();
  const viewport = (projectManager.listBrowserTabsByProject(ws.projectId)
    .find(t => t.chatId === chatId)?.viewportMode) || 'desktop';
  await applyViewport(page, viewport);

  const cdp = await context.newCDPSession(page);
  entry = { page, cdp, viewport, lastFrameAt: 0 };
  ws.tabs.set(chatId, entry);

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
    const tab = ws.tabs.get(chatId);
    if (tab && now - tab.lastFrameAt >= FRAME_INTERVAL_MS) {
      tab.lastFrameAt = now;
      io?.to(`claude:${chatId}`).emit('chat:browser-frame', {
        chatId,
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

  // Track URL changes so a Chromium crash can recover state on next launch.
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      try {
        projectManager.updateBrowserTab(chatId, { currentUrl: frame.url() });
      } catch { /* ignore */ }
    }
  });

  page.on('close', () => {
    ws.tabs.delete(chatId);
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
    // Tell playwright-cli to attach to OUR Chromium rather than launching its
    // own. Variable name mirrors Microsoft's CDP-connect convention; if the
    // CLI version we're on uses a different env key we'll surface it via the
    // first invocation's stderr and adjust.
    PLAYWRIGHT_CDP_ENDPOINT: cdpEndpoint,
  };
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
      child = spawn('playwright-cli', args, { cwd, env });
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
    const cliArgs = ['-s', ws.cliSession, ...msg.argv];
    const code = await runCli(cliArgs, env, msg.cwd, conn);
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
    const cliArgs = ['-s', ws.cliSession, ...argv];
    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let child: ChildProcess;
      try {
        child = spawn('playwright-cli', cliArgs, { cwd, env });
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

/** Build a short natural-language description for a takeover input event. */
function describeInput(ev: {
  kind: string; x?: number; y?: number; button?: string; deltaX?: number; deltaY?: number; key?: string; text?: string;
}): string {
  switch (ev.kind) {
    case 'mouse-click':
      return `Clicked${ev.button && ev.button !== 'left' ? ` (${ev.button})` : ''} at viewport (${Math.round(ev.x ?? 0)}, ${Math.round(ev.y ?? 0)})`;
    case 'mouse-down':
      return `Mouse down at (${Math.round(ev.x ?? 0)}, ${Math.round(ev.y ?? 0)})`;
    case 'mouse-up':
      return `Mouse up at (${Math.round(ev.x ?? 0)}, ${Math.round(ev.y ?? 0)})`;
    case 'mouse-wheel':
      return `Scrolled (${ev.deltaX ?? 0}, ${ev.deltaY ?? 0})`;
    case 'mouse-move':
      return `Moved cursor to (${Math.round(ev.x ?? 0)}, ${Math.round(ev.y ?? 0)})`;
    case 'key-down':
      return `Pressed ${ev.key}`;
    case 'key-up':
      return `Released ${ev.key}`;
    case 'type':
      return `Typed: ${JSON.stringify(ev.text ?? '')}`;
    default:
      return ev.kind;
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
  // event to the takeover log so we can summarize on resume.
  const takeoverId = ws.takeovers.get(chatId);
  if (takeoverId) {
    try {
      projectManager.recordTakeoverEvent(chatId, takeoverId, ev.kind, describeInput(ev));
    } catch { /* ignore */ }
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
  return { takeoverId: id, descriptions: events.map(e => e.description) };
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
  setPaused,
  isPaused,
  acquireLock,
  releaseLock,
  dispatchInput,
  beginTakeover,
  endTakeover,
  snapshotForChat,
  setViewportForChat,
  onSocketDisconnect,
  attachIO,
  shutdown,
  userDataDirFor,
};
