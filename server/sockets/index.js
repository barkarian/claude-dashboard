import registerTerminalEvents from './terminal.js';
import registerSDKClaudeEvents from './claude-sdk.ts';
import registerFileEvents from './files.js';

export default function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    registerTerminalEvents(socket, io);
    registerSDKClaudeEvents(socket, io);
    registerFileEvents(socket, io);

    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (err) => {
      console.error(`Socket error for ${socket.id}:`, err);
    });
  });
}
