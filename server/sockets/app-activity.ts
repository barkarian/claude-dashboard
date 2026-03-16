import type { Socket, Server as SocketIOServer } from 'socket.io';
import appActivityMonitor from '../services/appActivityMonitor.ts';

export default function registerAppActivityEvents(socket: Socket, _io: SocketIOServer): void {
  // Client subscribes to activity events for specific ports
  socket.on('app-activity:subscribe', ({ ports }: { ports: number[] }) => {
    for (const port of ports) {
      socket.join(`app-activity:${port}`);
      appActivityMonitor.startMonitoring(port);
    }
    console.log(`[app-activity] ${socket.id} subscribed to ports: ${ports.join(', ')}`);
  });

  // Client unsubscribes from activity events
  socket.on('app-activity:unsubscribe', ({ ports }: { ports: number[] }) => {
    for (const port of ports) {
      socket.leave(`app-activity:${port}`);
    }
    console.log(`[app-activity] ${socket.id} unsubscribed from ports: ${ports.join(', ')}`);
  });

  // Client requests to start monitoring a port
  socket.on('app-activity:start', ({ port }: { port: number }) => {
    appActivityMonitor.startMonitoring(port);
    socket.join(`app-activity:${port}`);
    console.log(`[app-activity] Started monitoring port ${port}`);
  });

  // Client requests to stop monitoring a port
  socket.on('app-activity:stop', ({ port }: { port: number }) => {
    appActivityMonitor.stopMonitoring(port);
    console.log(`[app-activity] Stopped monitoring port ${port}`);
  });

  // Client requests to clear buffered events
  socket.on('app-activity:clear', ({ port }: { port: number }) => {
    appActivityMonitor.clearEvents(port);
  });

  // Client requests current buffered events (for reconnection)
  socket.on('app-activity:get-buffer', ({ port }: { port: number }, callback: (events: any[]) => void) => {
    if (typeof callback === 'function') {
      callback(appActivityMonitor.getEvents(port));
    }
  });
}
