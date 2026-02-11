import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import type { SessionStatus } from '../../../shared/types/interactive.ts';

export function useSessionStatuses(projectId: string | undefined): Record<string, SessionStatus> {
  const { socket } = useSocket();
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});

  useEffect(() => {
    if (!socket || !projectId) return;

    socket.emit('project:join', { projectId }, (initial: Record<string, SessionStatus>) => {
      setStatuses(initial || {});
    });

    function handleSessionStatus({ chatId, status }: { chatId: string; status: SessionStatus }) {
      setStatuses((prev) => {
        if (status === 'exited') {
          const next = { ...prev };
          delete next[chatId];
          return next;
        }
        return { ...prev, [chatId]: status };
      });
    }

    socket.on('claude:session-status', handleSessionStatus);

    return () => {
      socket.emit('project:leave', { projectId });
      socket.off('claude:session-status', handleSessionStatus);
    };
  }, [socket, projectId]);

  return statuses;
}
