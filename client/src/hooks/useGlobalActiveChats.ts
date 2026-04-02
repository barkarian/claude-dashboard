import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import type { GlobalActiveChats } from '../../../shared/types/socket-events.ts';

const EMPTY: GlobalActiveChats = { byProject: {}, totalCount: 0, badgeCount: 0 };

/**
 * Subscribe to global active chat counts across all projects.
 * Used by the sidebar (per-project accordions) and badge count hooks.
 */
export function useGlobalActiveChats(): GlobalActiveChats {
  const { socket } = useSocket();
  const [data, setData] = useState<GlobalActiveChats>(EMPTY);

  useEffect(() => {
    if (!socket) return;

    // Request initial snapshot
    socket.emit('global:active-chats:get', (snapshot: GlobalActiveChats) => {
      if (snapshot) setData(snapshot);
    });

    // Listen for real-time updates
    function handleUpdate(snapshot: GlobalActiveChats) {
      setData(snapshot);
    }

    socket.on('global:active-chats', handleUpdate);

    return () => {
      socket.off('global:active-chats', handleUpdate);
    };
  }, [socket]);

  return data;
}
