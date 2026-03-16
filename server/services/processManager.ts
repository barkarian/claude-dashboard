import pty, { type IPty } from 'node-pty';
import type { Server as SocketIOServer } from 'socket.io';
import type { ProcessStatus } from '../../shared/types/models.ts';
import { detectPorts } from './portDetector.ts';
import tunnelManager from './tunnelManager.ts';
import { emitSidecarEvent } from './sidecarEmitter.ts';

const MAX_BUFFER_LINES = 5000;

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

function spawnProcess(projectId: string, scriptId: string, command: string, cwd: string, io: SocketIOServer): ProcessEntry {
  // Kill existing process if any
  killProcess(projectId, scriptId);

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const args = process.platform === 'win32' ? [] : ['-c', command];

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

  ptyProcess.onData((data: string) => {
    buffer.push(data);
    if (buffer.length > MAX_BUFFER_LINES) {
      buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
    }
    if (io) {
      io.to(room).emit('terminal:output', { projectId, scriptId, data });
    }
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    entry.status = 'exited';
    entry.exitCode = exitCode;
    tunnelManager.closeTunnelsForProcess(`${projectId}:${scriptId}`).catch(() => {});
    if (io) {
      io.to(room).emit('terminal:exit', { projectId, scriptId, exitCode });
      io.to(room).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
      io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
    }
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

  return entry;
}

function spawnShell(projectId: string, scriptId: string, cwd: string, io: SocketIOServer): ProcessEntry {
  // Kill existing process if any
  killProcess(projectId, scriptId);

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  // Use -i (interactive) instead of --login to avoid profile scripts overriding cwd
  const args = process.platform === 'win32' ? [] : ['-i'];

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
    command: 'bash',
    projectId,
    scriptId,
  };

  if (!processes.has(projectId)) {
    processes.set(projectId, new Map());
  }
  processes.get(projectId)!.set(scriptId, entry);

  const room = `terminal:${projectId}:${scriptId}`;

  ptyProcess.onData((data: string) => {
    buffer.push(data);
    if (buffer.length > MAX_BUFFER_LINES) {
      buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
    }
    if (io) {
      io.to(room).emit('terminal:output', { projectId, scriptId, data });
    }
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    entry.status = 'exited';
    entry.exitCode = exitCode;
    tunnelManager.closeTunnelsForProcess(`${projectId}:${scriptId}`).catch(() => {});
    if (io) {
      io.to(room).emit('terminal:exit', { projectId, scriptId, exitCode });
      io.to(room).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
      io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
    }
  });

  if (io) {
    io.to(room).emit('terminal:status', { projectId, scriptId, status: 'running' });
    io.to(`project:${projectId}`).emit('terminal:status', { projectId, scriptId, status: 'running' });
  }

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
  killAllForProject,
  killAll,
};
