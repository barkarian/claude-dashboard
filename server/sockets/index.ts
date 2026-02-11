import type { Server as SocketIOServer, Socket } from 'socket.io';
import registerTerminalEvents from './terminal.ts';
import registerSDKClaudeEvents from './claude-sdk.ts';
import registerFileEvents from './files.ts';

export default function registerSocketHandlers(io: SocketIOServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    registerTerminalEvents(socket, io);
    registerSDKClaudeEvents(socket, io);
    registerFileEvents(socket, io);

    socket.on('disconnect', (reason: string) => {
      console.log(`Client disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (err: Error) => {
      console.error(`Socket error for ${socket.id}:`, err);
    });
  });
}
