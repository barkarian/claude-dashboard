import aiGenerator from '../services/aiGenerator.ts';
import projectManager from '../services/projectManager.ts';
import type { Socket, Server as SocketIOServer } from 'socket.io';

interface AIGenerateCommandPayload {
  sessionId: string;
  projectId: string;
  description: string;
}

interface AIGenerateScriptsPayload {
  sessionId: string;
  projectId: string;
  mode: 'auto-detect' | 'describe';
  description?: string;
}

interface AICancelPayload {
  sessionId: string;
}

export default function registerAIGenerateEvents(socket: Socket, io: SocketIOServer): void {
  socket.on('ai:generate-command', async ({ sessionId, projectId, description }: AIGenerateCommandPayload) => {
    try {
      const room = `ai:${sessionId}`;
      socket.join(room);

      const projectPath = projectManager.getProjectPath(projectId);
      // Fire and forget — events stream back via the room
      aiGenerator.generateCommand(sessionId, projectPath, description, socket.id, io);
    } catch (err: any) {
      socket.emit('ai:error', { sessionId, error: err.message });
    }
  });

  socket.on('ai:generate-scripts', async ({ sessionId, projectId, mode, description }: AIGenerateScriptsPayload) => {
    try {
      const room = `ai:${sessionId}`;
      socket.join(room);

      const projectPath = projectManager.getProjectPath(projectId);
      aiGenerator.generateScripts(sessionId, projectPath, mode, description, socket.id, io);
    } catch (err: any) {
      socket.emit('ai:error', { sessionId, error: err.message });
    }
  });

  socket.on('ai:cancel', ({ sessionId }: AICancelPayload) => {
    aiGenerator.cancel(sessionId);
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    // Sessions will clean themselves up via abort
  });
}
