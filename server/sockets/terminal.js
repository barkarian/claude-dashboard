import processManager from '../services/processManager.js';
import projectManager from '../services/projectManager.js';

export default function registerTerminalEvents(socket, io) {
  socket.on('terminal:start', async ({ projectId, scriptId }) => {
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
    } catch (err) {
      console.error('terminal:start error:', err);
      socket.emit('terminal:error', { projectId, scriptId, error: err.message });
    }
  });

  socket.on('terminal:stop', ({ projectId, scriptId }) => {
    processManager.killProcess(projectId, scriptId);
  });

  socket.on('terminal:input', ({ projectId, scriptId, data }) => {
    processManager.writeToProcess(projectId, scriptId, data);
  });

  socket.on('terminal:resize', ({ projectId, scriptId, cols, rows }) => {
    processManager.resizeProcess(projectId, scriptId, cols, rows);
  });

  socket.on('terminal:attach', ({ projectId, scriptId }) => {
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

  socket.on('terminal:detach', ({ projectId, scriptId }) => {
    const room = `terminal:${projectId}:${scriptId}`;
    socket.leave(room);
  });
}
