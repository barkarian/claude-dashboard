import type { Socket, Server as SocketIOServer } from 'socket.io';
import os from 'os';
import processManager from '../services/processManager.ts';
import projectManager from '../services/projectManager.ts';
import type {
  TerminalStartPayload,
  TerminalStopPayload,
  TerminalInputPayload,
  TerminalResizePayload,
  TerminalAttachPayload,
  TerminalDetachPayload,
  TerminalSpawnShellPayload,
} from '../../shared/types/socket-events.ts';

export default function registerTerminalEvents(socket: Socket, io: SocketIOServer): void {
  socket.on('terminal:start', async ({ projectId, scriptId }: TerminalStartPayload) => {
    try {
      const project = await projectManager.getProject(projectId);
      if (!project) {
        socket.emit('terminal:error', { projectId, scriptId, error: 'Project not found' });
        return;
      }

      const script = (project.scripts || []).find(s => s.id === scriptId);
      if (!script) {
        socket.emit('terminal:error', { projectId, scriptId, error: 'Script not found' });
        return;
      }

      const cwd = projectManager.getProjectPath(projectId);
      const room = `terminal:${projectId}:${scriptId}`;
      socket.join(room);

      processManager.spawnProcess(projectId, scriptId, script.command, cwd, io);
    } catch (err: any) {
      console.error('terminal:start error:', err);
      socket.emit('terminal:error', { projectId, scriptId, error: err.message });
    }
  });

  socket.on('terminal:spawn-shell', async ({ projectId }: TerminalSpawnShellPayload) => {
    try {
      const cwd = projectManager.getProjectPath(projectId);
      const scriptId = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const room = `terminal:${projectId}:${scriptId}`;
      socket.join(room);

      processManager.spawnShell(projectId, scriptId, cwd, io);
      socket.emit('terminal:shell-spawned', { projectId, scriptId });
    } catch (err: any) {
      console.error('terminal:spawn-shell error:', err);
      socket.emit('terminal:error', { projectId, scriptId: '', error: err.message });
    }
  });

  socket.on('terminal:spawn-settings-shell', async () => {
    try {
      const cwd = os.homedir();
      const scriptId = `settings-shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const projectId = '__settings__';
      const room = `terminal:${projectId}:${scriptId}`;
      socket.join(room);
      processManager.spawnShell(projectId, scriptId, cwd, io);
      socket.emit('terminal:shell-spawned', { projectId, scriptId });
    } catch (err: any) {
      console.error('terminal:spawn-settings-shell error:', err);
      socket.emit('terminal:error', { projectId: '__settings__', scriptId: '', error: err.message });
    }
  });

  socket.on('terminal:stop', ({ projectId, scriptId }: TerminalStopPayload) => {
    processManager.killProcess(projectId, scriptId);
  });

  socket.on('terminal:input', ({ projectId, scriptId, data }: TerminalInputPayload) => {
    processManager.writeToProcess(projectId, scriptId, data);
  });

  socket.on('terminal:resize', ({ projectId, scriptId, cols, rows }: TerminalResizePayload) => {
    processManager.resizeProcess(projectId, scriptId, cols, rows);
  });

  socket.on('terminal:attach', ({ projectId, scriptId }: TerminalAttachPayload) => {
    const room = `terminal:${projectId}:${scriptId}`;
    socket.join(room);

    // Replay buffer
    const buffer = processManager.getBuffer(projectId, scriptId);
    if (buffer) {
      socket.emit('terminal:output', { projectId, scriptId, data: buffer });
    }

    // Send current status
    const entry = processManager.getProcess(projectId, scriptId);
    if (entry) {
      socket.emit('terminal:status', {
        projectId,
        scriptId,
        status: entry.status,
        exitCode: entry.exitCode,
      });
    }
  });

  socket.on('terminal:detach', ({ projectId, scriptId }: TerminalDetachPayload) => {
    const room = `terminal:${projectId}:${scriptId}`;
    socket.leave(room);
  });
}
