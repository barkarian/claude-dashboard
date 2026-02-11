import type { Socket, Server as SocketIOServer } from 'socket.io';
import fileService from '../services/fileService.ts';
import projectManager from '../services/projectManager.ts';
import type {
  FilesListPayload,
  FilesWatchPayload,
  FilesContentPayload,
} from '../../shared/types/socket-events.ts';

export default function registerFileEvents(socket: Socket, io: SocketIOServer): void {
  socket.on('files:list', async ({ projectId }: FilesListPayload) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const files = await fileService.listProjectFiles(projectPath);
      socket.emit('files:list', { projectId, files });
    } catch (err: any) {
      console.error('files:list error:', err);
      socket.emit('files:error', { projectId, error: err.message });
    }
  });

  socket.on('files:watch-start', ({ projectId }: FilesWatchPayload) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const room = `project:${projectId}`;
      socket.join(room);
      fileService.startWatching(projectPath, projectId, io);
    } catch (err) {
      console.error('files:watch-start error:', err);
    }
  });

  socket.on('files:watch-stop', ({ projectId }: FilesWatchPayload) => {
    const room = `project:${projectId}`;
    socket.leave(room);
  });

  socket.on('files:content', async ({ projectId, filePath }: FilesContentPayload) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const content = await fileService.getFileContent(projectPath, filePath!);
      socket.emit('files:content', { projectId, filePath, content });
    } catch (err: any) {
      socket.emit('files:error', { projectId, error: err.message });
    }
  });
}
