import fileService from '../services/fileService.js';
import projectManager from '../services/projectManager.js';

export default function registerFileEvents(socket, io) {
  socket.on('files:list', async ({ projectId }) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const files = await fileService.listProjectFiles(projectPath);
      socket.emit('files:list', { projectId, files });
    } catch (err) {
      console.error('files:list error:', err);
      socket.emit('files:error', { projectId, error: err.message });
    }
  });

  socket.on('files:watch-start', ({ projectId }) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const room = `project:${projectId}`;
      socket.join(room);
      fileService.startWatching(projectPath, projectId, io);
    } catch (err) {
      console.error('files:watch-start error:', err);
    }
  });

  socket.on('files:watch-stop', ({ projectId }) => {
    const room = `project:${projectId}`;
    socket.leave(room);
  });

  socket.on('files:content', async ({ projectId, filePath }) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const content = await fileService.getFileContent(projectPath, filePath);
      socket.emit('files:content', { projectId, filePath, content });
    } catch (err) {
      socket.emit('files:error', { projectId, error: err.message });
    }
  });
}
