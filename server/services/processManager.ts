import pty, { type IPty } from 'node-pty';
import type { Server as SocketIOServer } from 'socket.io';
import type { ProcessStatus, RunningProcess } from '../../shared/types/models.ts';
import { detectPorts } from './portDetector.ts';
import tunnelManager from './tunnelManager.ts';
import projectManager from './projectManager.ts';
import { emitSidecarEvent } from './sidecarEmitter.ts';
import config from '../config.ts';

const MAX_BUFFER_LINES = 5000;

// Cached user shell preference (fetched from tunnel-service)
let preferredShell: string | null = null;

const SHELL_BINARY_MAP: Record<string, string> = {
  bash: 'bash',
  zsh: 'zsh',
  fish: 'fish',
  sh: 'sh',
  powershell: process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
  wsl: 'wsl',
};

function getShell(projectShellOverride?: string | null): string {
  const effective = projectShellOverride || preferredShell;
  if (process.platform === 'win32') {
    if (effective === 'wsl') return 'wsl';
    if (effective === 'powershell') return 'powershell.exe';
    return 'powershell.exe';
  }
  if (effective && SHELL_BINARY_MAP[effective]) {
    return SHELL_BINARY_MAP[effective];
  }
  return 'bash';
}

function getShellArgs(mode: 'command' | 'interactive', command?: string, projectShellOverride?: string | null): string[] {
  const shell = getShell(projectShellOverride);
  if (mode === 'command' && command) {
    if (shell === 'wsl') return ['-e', 'bash', '-c', command];
    if (shell === 'powershell.exe' || shell === 'pwsh') return ['-Command', command];
    return ['-c', command]; // bash, zsh, fish, sh all support -c
  }
  // interactive mode
  if (shell === 'wsl' || shell === 'powershell.exe' || shell === 'pwsh') return [];
  return ['-i']; // bash, zsh, fish, sh
}

async function fetchPreferredShell(): Promise<void> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) return;
  try {
    const env = config.dashboardEnv; // 'local' or 'vps'
    const res = await fetch(`${config.tunnelServiceUrl}/api/account/preferences?environment=${env}`, {
      headers: { 'Authorization': `users API-Key ${creds.apiKey}` },
    });
    if (res.ok) {
      const data = await res.json() as { preferredShell?: string };
      preferredShell = data.preferredShell || null;
      console.log(`[process] User preferred shell (${env}): ${preferredShell || 'default (bash)'}`);
    }
  } catch {
    console.log('[process] Failed to fetch shell preference, using default');
  }
}

function setPreferredShell(shell: string | null): void {
  preferredShell = shell;
}

function getPreferredShell(): string | null {
  return preferredShell;
}

// Cached port detection state
const cachedPorts = new Map<string, number[]>();
const portCheckTimers = new Map<string, NodeJS.Timeout>();

// Store io ref for broadcasting from non-spawn contexts
let ioRef: SocketIOServer | null = null;

// Env vars set by the dashboard that should NOT leak into child processes
const DASHBOARD_ENV_KEYS = ['PORT', 'TUNNEL_API_KEY', 'TUNNEL_USER_SUBDOMAIN', 'SESSION_SECRET', 'TUNNEL_MODE', 'NGROK_AUTHTOKEN', 'TUNNEL_SERVICE_URL'];

function getChildEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of DASHBOARD_ENV_KEYS) {
    delete env[key];
  }
  env.TERM = 'xterm-256color';
  return env;
}

interface ProcessEntry {
  pty: IPty;
  buffer: string[];
  status: ProcessStatus;
  startedAt: string;
  exitCode: number | null;
  command: string;
  projectId: string;
  scriptId: string;
}

// Map<projectId, Map<scriptId, ProcessEntry>>
const processes = new Map<string, Map<string, ProcessEntry>>();

function getKey(projectId: string, scriptId: string): string {
  return `${projectId}:${scriptId}`;
}

function getProjectProcesses(projectId: string): Map<string, ProcessEntry> {
  const projectMap = processes.get(projectId);
  if (!projectMap) return new Map();
  return projectMap;
}

function getProcess(projectId: string, scriptId: string): ProcessEntry | null {
  const projectMap = processes.get(projectId);
  if (!projectMap) return null;
  return projectMap.get(scriptId) || null;
}

/** Build the full RunningProcess[] for a project (using cached ports). */
async function getProcessesList(projectId: string): Promise<RunningProcess[]> {
  const scripts = projectManager.listScripts(projectId);
  const projectProcesses = getProjectProcesses(projectId);
  const result: RunningProcess[] = [];

  for (const [scriptId, entry] of projectProcesses) {
    const matchedScript = scripts.find((s: { id: string }) => s.id === scriptId);
    const isShell = scriptId.startsWith('shell-');
    const key = getKey(projectId, scriptId);
    const ports = entry.status === 'running' ? (cachedPorts.get(key) || []) : [];
    const tunnelUrls = (entry.status === 'running' && ports.length > 0)
      ? await tunnelManager.getTunnelUrls(ports, key)
      : {};
    result.push({
      scriptId,
      command: entry.command,
      status: entry.status,
      startedAt: entry.startedAt,
      exitCode: entry.exitCode,
      label: isShell ? 'Terminal' : matchedScript?.label,
      isShell,
      detectedPorts: ports,
      tunnelUrls,
    });
  }

  return result;
}

/** Broadcast full process list to all clients in the project room. */
async function broadcastProcesses(projectId: string): Promise<void> {
  if (!ioRef) return;
  const processList = await getProcessesList(projectId);
  const runningCount = processList.filter(p => p.status === 'running').length;
  ioRef.to(`project:${projectId}`).emit('processes:updated', { projectId, processes: processList, runningCount });
}

/** Schedule debounced port detection for a process (runs 2s after last call). */
function schedulePortCheck(projectId: string, scriptId: string, entry: ProcessEntry): void {
  const key = getKey(projectId, scriptId);
  if (portCheckTimers.has(key)) return; // already scheduled
  portCheckTimers.set(key, setTimeout(async () => {
    portCheckTimers.delete(key);
    if (entry.status !== 'running') return;
    const newPorts = await detectPorts(entry.buffer.join(''));
    const oldPorts = cachedPorts.get(key) || [];
    if (JSON.stringify(newPorts) !== JSON.stringify(oldPorts)) {
      cachedPorts.set(key, newPorts);
      broadcastProcesses(projectId);
    }
  }, 2000));
}

function spawnProcess(projectId: string, scriptId: string, command: string, cwd: string, io: SocketIOServer): ProcessEntry {
  ioRef = io;
  // Kill existing process if any
  killProcess(projectId, scriptId);

  // Check for per-project shell override
  const project = projectManager.getProject(projectId);
  const shellOverride = project?.shellOverride;
  const shell = getShell(shellOverride);
  const args = getShellArgs('command', command, shellOverride);

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: getChildEnv(),
  });

  const buffer: string[] = [];
  const entry: ProcessEntry = {
    pty: ptyProcess,
    buffer,
    status: 'running',
    startedAt: new Date().toISOString(),
    exitCode: null,
    command,
    projectId,
    scriptId,
  };

  if (!processes.has(projectId)) {
    processes.set(projectId, new Map());
  }
  processes.get(projectId)!.set(scriptId, entry);

  const room = `terminal:${projectId}:${scriptId}`;
  const key = getKey(projectId, scriptId);
  cachedPorts.set(key, []);

  ptyProcess.onData((data: string) => {
    buffer.push(data);
    if (buffer.length > MAX_BUFFER_LINES) {
      buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
    }
    if (io) {
      io.to(room).emit('terminal:output', { projectId, scriptId, data });
    }
    schedulePortCheck(projectId, scriptId, entry);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    entry.status = 'exited';
    entry.exitCode = exitCode;
    // Clean up port detection state
    const k = getKey(projectId, scriptId);
    cachedPorts.delete(k);
    const timer = portCheckTimers.get(k);
    if (timer) { clearTimeout(timer); portCheckTimers.delete(k); }
    tunnelManager.closeTunnelsForProcess(k).catch(() => {});
    if (io) {
      io.to(room).emit('terminal:exit', { projectId, scriptId, exitCode });
      io.to(room).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
      io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
    }
    broadcastProcesses(projectId);
    // Notify desktop shell of build completion/failure
    emitSidecarEvent({
      type: 'notification',
      title: exitCode === 0 ? 'Build Complete' : 'Build Failed',
      body: exitCode === 0 ? `"${command}" finished successfully` : `"${command}" exited with code ${exitCode}`,
      deepLink: `/projects/${projectId}`,
      event: exitCode === 0 ? 'build-complete' : 'build-failed',
    });
  });

  if (io) {
    io.to(room).emit('terminal:status', { projectId, scriptId, status: 'running' });
    io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'running' });
  }
  broadcastProcesses(projectId);

  return entry;
}

function spawnShell(projectId: string, scriptId: string, cwd: string, io: SocketIOServer): ProcessEntry {
  ioRef = io;
  // Kill existing process if any
  killProcess(projectId, scriptId);

  // Check for per-project shell override
  const project = projectManager.getProject(projectId);
  const shellOverride = project?.shellOverride;
  const shell = getShell(shellOverride);
  const args = getShellArgs('interactive', undefined, shellOverride);

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: getChildEnv(),
  });

  const buffer: string[] = [];
  const entry: ProcessEntry = {
    pty: ptyProcess,
    buffer,
    status: 'running',
    startedAt: new Date().toISOString(),
    exitCode: null,
    command: shell,
    projectId,
    scriptId,
  };

  if (!processes.has(projectId)) {
    processes.set(projectId, new Map());
  }
  processes.get(projectId)!.set(scriptId, entry);

  const room = `terminal:${projectId}:${scriptId}`;
  const key = getKey(projectId, scriptId);
  cachedPorts.set(key, []);

  ptyProcess.onData((data: string) => {
    buffer.push(data);
    if (buffer.length > MAX_BUFFER_LINES) {
      buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
    }
    if (io) {
      io.to(room).emit('terminal:output', { projectId, scriptId, data });
    }
    schedulePortCheck(projectId, scriptId, entry);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    entry.status = 'exited';
    entry.exitCode = exitCode;
    const k = getKey(projectId, scriptId);
    cachedPorts.delete(k);
    const timer = portCheckTimers.get(k);
    if (timer) { clearTimeout(timer); portCheckTimers.delete(k); }
    tunnelManager.closeTunnelsForProcess(k).catch(() => {});
    if (io) {
      io.to(room).emit('terminal:exit', { projectId, scriptId, exitCode });
      io.to(room).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
      io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
    }
    broadcastProcesses(projectId);
  });

  if (io) {
    io.to(room).emit('terminal:status', { projectId, scriptId, status: 'running' });
    io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'running' });
  }
  broadcastProcesses(projectId);

  return entry;
}

function killProcess(projectId: string, scriptId: string): ProcessEntry | undefined {
  const entry = getProcess(projectId, scriptId);
  if (!entry || entry.status !== 'running') return;

  tunnelManager.closeTunnelsForProcess(`${projectId}:${scriptId}`).catch(() => {});

  try {
    entry.pty.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (entry.status === 'running') {
          entry.pty.kill('SIGKILL');
        }
      } catch {
        // Process already dead
      }
    }, 3000);
  } catch {
    // Process already dead
  }

  entry.status = 'exited';
  return entry;
}

function writeToProcess(projectId: string, scriptId: string, data: string): boolean {
  const entry = getProcess(projectId, scriptId);
  if (!entry || entry.status !== 'running') return false;
  entry.pty.write(data);
  return true;
}

function resizeProcess(projectId: string, scriptId: string, cols: number, rows: number): boolean {
  const entry = getProcess(projectId, scriptId);
  if (!entry || entry.status !== 'running') return false;
  try {
    entry.pty.resize(cols, rows);
    return true;
  } catch {
    return false;
  }
}

function getBuffer(projectId: string, scriptId: string): string {
  const entry = getProcess(projectId, scriptId);
  if (!entry) return '';
  return entry.buffer.join('');
}

async function getDetectedPorts(projectId: string, scriptId: string): Promise<number[]> {
  const entry = getProcess(projectId, scriptId);
  if (!entry) return [];
  return detectPorts(entry.buffer.join(''));
}

function killAllForProject(projectId: string): void {
  const projectMap = processes.get(projectId);
  if (!projectMap) return;
  for (const [scriptId] of projectMap) {
    killProcess(projectId, scriptId);
  }
  processes.delete(projectId);
}

function killAll(): void {
  for (const [projectId] of processes) {
    killAllForProject(projectId);
  }
}

export default {
  spawnProcess,
  spawnShell,
  killProcess,
  writeToProcess,
  resizeProcess,
  getProcess,
  getProjectProcesses,
  getBuffer,
  getDetectedPorts,
  getProcessesList,
  killAllForProject,
  killAll,
  fetchPreferredShell,
  setPreferredShell,
  getPreferredShell,
};
