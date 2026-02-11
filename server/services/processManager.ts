import pty, { type IPty } from 'node-pty';
import type { Server as SocketIOServer } from 'socket.io';
import type { ProcessStatus } from '../../shared/types/models.ts';

const MAX_BUFFER_LINES = 5000;

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
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
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
  killProcess,
  writeToProcess,
  resizeProcess,
  getProcess,
  getProjectProcesses,
  getBuffer,
  killAllForProject,
  killAll,
};
