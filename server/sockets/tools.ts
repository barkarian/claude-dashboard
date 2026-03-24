import type { Socket, Server as SocketIOServer } from 'socket.io';
import toolManager from '../services/toolManager.ts';

export default function registerToolEvents(socket: Socket, _io: SocketIOServer): void {
  socket.on('tools:install', ({ toolId }: { toolId: string }) => {
    try {
      toolManager.install(toolId, {
        onData: (data: string) => {
          socket.emit('tools:install-output', { toolId, data });
        },
        onComplete: async (success: boolean, error?: string) => {
          // Re-detect the tool to get updated status
          let tool = null;
          try {
            tool = await toolManager.detect(toolId);
          } catch { /* ignore */ }
          socket.emit('tools:install-complete', { toolId, success, error, tool });
        },
      });
      socket.emit('tools:install-started', { toolId });
    } catch (err: any) {
      socket.emit('tools:install-complete', { toolId, success: false, error: err.message });
    }
  });

  socket.on('tools:install-cancel', ({ toolId }: { toolId: string }) => {
    const cancelled = toolManager.cancelInstall(toolId);
    socket.emit('tools:install-cancelled', { toolId, cancelled });
  });
}
