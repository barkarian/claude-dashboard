import pty from 'node-pty';

const MAX_BUFFER_LINES = 5000;

// Map<string, Map<string, ProcessEntry>>
const processes = new Map();

function getKey(projectId, scriptId) {
  return `${projectId}:${scriptId}`;
}

function getProjectProcesses(projectId) {
  const projectMap = processes.get(projectId);
  if (!projectMap) return new Map();
  return projectMap;
}

function getProcess(projectId, scriptId) {
  const projectMap = processes.get(projectId);
  if (!projectMap) return null;
  return projectMap.get(scriptId) || null;
}

function spawnProcess(projectId, scriptId, command, cwd, io) {
  // Kill existing process if any
  killProcess(projectId, scriptId);

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const args = process.platform === 'win32' ? [] : ['-c', command];

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  const buffer = [];
  const entry = {
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
  processes.get(projectId).set(scriptId, entry);

  const room = `terminal:${projectId}:${scriptId}`;

  ptyProcess.onData((data) => {
    buffer.push(data);
    if (buffer.length > MAX_BUFFER_LINES) {
      buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
    }
    if (io) {
      io.to(room).emit('terminal:output', { projectId, scriptId, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    entry.status = 'exited';
    entry.exitCode = exitCode;
    if (io) {
      io.to(room).emit('terminal:exit', { projectId, scriptId, exitCode });
      io.to(room).emit('terminal:status', { projectId, scriptId, status: 'exited', exitCode });
    }
  });

  if (io) {
    io.to(room).emit('terminal:status', { projectId, scriptId, status: 'running' });
  }

  return entry;
}

function killProcess(projectId, scriptId) {
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

function writeToProcess(projectId, scriptId, data) {
  const entry = getProcess(projectId, scriptId);
  if (!entry || entry.status !== 'running') return false;
  entry.pty.write(data);
  return true;
}

function resizeProcess(projectId, scriptId, cols, rows) {
  const entry = getProcess(projectId, scriptId);
  if (!entry || entry.status !== 'running') return false;
  try {
    entry.pty.resize(cols, rows);
    return true;
  } catch {
    return false;
  }
}

function getBuffer(projectId, scriptId) {
  const entry = getProcess(projectId, scriptId);
  if (!entry) return '';
  return entry.buffer.join('');
}

function killAllForProject(projectId) {
  const projectMap = processes.get(projectId);
  if (!projectMap) return;
  for (const [scriptId] of projectMap) {
    killProcess(projectId, scriptId);
  }
  processes.delete(projectId);
}

function killAll() {
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
