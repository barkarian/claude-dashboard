import type { Server as SocketIOServer, Socket } from 'socket.io';
import registerTerminalEvents from './terminal.ts';
import registerSDKClaudeEvents from './claude-sdk.ts';
import registerClaudeCodeEvents from './claude-code.ts';
import registerFileEvents from './files.ts';
import registerAIGenerateEvents from './ai-generate.ts';
import registerToolEvents from './tools.ts';
import activeChatsTracker from '../services/activeChatsTracker.ts';

export default function registerSocketHandlers(io: SocketIOServer): void {
  // Initialize global active chats tracker
  activeChatsTracker.init(io);

  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Auto-join global active chats room for sidebar badges + dock badge
    socket.join('global:active-chats');

    // Return current snapshot on request
    socket.on('global:active-chats:get', (callback?: Function) => {
      callback?.(activeChatsTracker.getSnapshot());
    });

    registerTerminalEvents(socket, io);
    registerSDKClaudeEvents(socket, io);
    registerClaudeCodeEvents(socket, io);
    registerFileEvents(socket, io);
    registerAIGenerateEvents(socket, io);
    registerToolEvents(socket, io);

    socket.on('disconnect', (reason: string) => {
      console.log(`Client disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (err: Error) => {
      console.error(`Socket error for ${socket.id}:`, err);
    });
  });
}
