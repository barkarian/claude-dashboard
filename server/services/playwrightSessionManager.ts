// playwrightSessionManager — server-side singleton that owns the persistent
// Chromium per workspace, the per-chat tab map, and the IPC socket the
// `claw-browser` shim talks to.
//
// Phase 1 scope:
//   - Listen on a per-project unix socket (/tmp/claw-browser-<projectId>.sock).
//   - Forward `exec` messages to playwright-cli, scoped to the project's
//     PLAYWRIGHT_CLI_SESSION + the chat's tab.
//   - Maintain the chat→tab mapping in chat_browser_tabs.
//   - Honor a paused flag (per workspace) — block exec until resumed.
//
// Deferred to later phases:
//   - CDP screencast subscription
//   - Input dispatch (takeover)
//   - Viewport mode switching
//   - First-run Chromium binary download UX (for now we trust playwright-cli's
//     own auto-install behavior on first command)
//
// Process model: we shell out to `playwright-cli` (resolved via PATH which the
// server bootstrap prepends with node_modules/.bin). Each exec is a separate
// short-lived `playwright-cli` invocation; the persistent Chromium lives in
// the playwright-cli daemon, not in our process.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server as SocketIOServer } from 'socket.io';
import projectManager from './projectManager.ts';
import { isBrowserEnabled } from '../config.ts';

interface ExecMessage {
  type: 'exec';
  projectId: string;
  chatId: string;
  tabId: string | null;
  argv: string[];
  cwd: string;
}

interface WorkspaceState {
  projectId: string;
  cliSession: string;
  paused: boolean;
  /** Single-flight queue: only one playwright-cli child runs at a time per
   *  workspace, so tab selection + command don't race across chats. */
  queue: Array<() => void>;
  active: boolean;
}

const workspaces = new Map<string, WorkspaceState>();
const servers = new Map<string, net.Server>();
let io: SocketIOServer | null = null;

function getDataRoot(): string {
  if (process.env.CLAW_DESKTOP === '1') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'com.claw-dev.desktop', 'data');
  }
  return path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
}

function userDataDirFor(projectId: string): string {
  const dir = path.join(getDataRoot(), 'browser-profiles', projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getOrCreateWorkspace(projectId: string): WorkspaceState {
  let ws = workspaces.get(projectId);
  if (!ws) {
    ws = {
      projectId,
      cliSession: `workspace_${projectId}`,
      paused: false,
      queue: [],
      active: false,
    };
    workspaces.set(projectId, ws);
  }
  return ws;
}

function socketPathFor(projectId: string): string {
  return path.join(os.tmpdir(), `claw-browser-${projectId}.sock`);
}

/** Run `playwright-cli` with the given args, streaming stdout/stderr/exit
 *  through the JSON-line protocol the shim expects. */
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
    child.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });
}

async function execOnWorkspace(
  ws: WorkspaceState,
  msg: ExecMessage,
  conn: net.Socket,
): Promise<void> {
  // Wait our turn in the per-workspace queue.
  if (ws.active) {
    await new Promise<void>((r) => ws.queue.push(r));
  }
  ws.active = true;

  try {
    if (ws.paused) {
      conn.write(JSON.stringify({
        type: 'stderr',
        data: 'claw-browser: workspace paused — user has control. Wait for resume before issuing more commands.\n',
      }) + '\n');
      conn.write(JSON.stringify({ type: 'exit', code: 4 }) + '\n');
      return;
    }

    // Make sure the chat's tab row exists. If the agent has never opened a
    // browser in this chat, this seeds the placeholder; the manager will
    // assign a real tab id once playwright-cli reports one back (Phase 3).
    if (msg.chatId) {
      projectManager.getOrCreateBrowserTab(msg.chatId, ws.projectId);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PLAYWRIGHT_CLI_SESSION: ws.cliSession,
      // Persistent profile dir = the user's "real Chromium" for this workspace.
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || undefined as any,
    };

    // Forward the agent's args verbatim to playwright-cli, scoped to our
    // session. Tab selection still falls to whatever playwright-cli does by
    // default in v1; per-chat tab targeting is wired in Phase 3 when we
    // capture tab IDs from playwright-cli output.
    const cliArgs = ['-s', ws.cliSession, ...msg.argv];

    const code = await runCli(cliArgs, env, msg.cwd, conn);
    conn.write(JSON.stringify({ type: 'exit', code }) + '\n');

    // Best-effort: if the command was a navigation, record the URL on the tab
    // so a Chromium crash + restart can recover state.
    if (msg.argv[0] === 'goto' || msg.argv[0] === 'open') {
      const url = msg.argv.find((a, i) => i > 0 && /^https?:\/\//.test(a));
      if (url) {
        try { projectManager.updateBrowserTab(msg.chatId, { currentUrl: url }); } catch { /* ignore */ }
      }
    }
  } finally {
    ws.active = false;
    const next = ws.queue.shift();
    if (next) next();
  }
}

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
  conn.on('error', () => { /* ignore — shim will exit on its end */ });
}

export function ensureWorkspaceServer(projectId: string): void {
  if (!isBrowserEnabled) return;
  if (servers.has(projectId)) return;

  const sockPath = socketPathFor(projectId);
  // Stale socket from a prior crash blocks listen() with EADDRINUSE on macOS.
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

  // Ensure we have a workspace state (lazy on first connection too, but
  // pre-creating lets us track paused state cleanly).
  getOrCreateWorkspace(projectId);
}

/**
 * In-process exec for SDK chats — bypasses the IPC socket since MCP tools run
 * in the dashboard process. Same per-workspace serialization as the IPC path.
 */
export async function execForChat(
  projectId: string,
  chatId: string,
  argv: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number; paused?: true }> {
  if (!isBrowserEnabled) {
    return {
      stdout: '',
      stderr: 'Browser automation is disabled in this environment (DASHBOARD_ENV=local required).\n',
      code: 5,
    };
  }
  const ws = getOrCreateWorkspace(projectId);
  if (ws.active) {
    await new Promise<void>((r) => ws.queue.push(r));
  }
  ws.active = true;
  try {
    if (ws.paused) {
      return {
        stdout: '',
        stderr: 'claw-browser: workspace paused — user has control.\n',
        code: 4,
        paused: true,
      };
    }
    projectManager.getOrCreateBrowserTab(chatId, projectId);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PLAYWRIGHT_CLI_SESSION: ws.cliSession,
    };
    const cliArgs = ['-s', ws.cliSession, ...argv];
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
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
    if (argv[0] === 'goto' || argv[0] === 'open') {
      const url = argv.find((a, i) => i > 0 && /^https?:\/\//.test(a));
      if (url) {
        try { projectManager.updateBrowserTab(chatId, { currentUrl: url }); } catch { /* ignore */ }
      }
    }
    return result;
  } finally {
    ws.active = false;
    const next = ws.queue.shift();
    if (next) next();
  }
}

export function setPaused(projectId: string, paused: boolean): void {
  const ws = getOrCreateWorkspace(projectId);
  ws.paused = paused;
}

export function isPaused(projectId: string): boolean {
  return !!workspaces.get(projectId)?.paused;
}

export function attachIO(server: SocketIOServer): void {
  io = server;
}

export function shutdown(): void {
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
  attachIO,
  shutdown,
  userDataDirFor,
};
