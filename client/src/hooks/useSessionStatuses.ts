import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import type { SessionStateContext } from '../../../shared/types/session.ts';

/**
 * Unified session states from the JSONL watcher + SDK session manager.
 * Returns rich SessionStateContext for each active chat.
 */
export function useSessionStates(projectId: string | undefined): Record<string, SessionStateContext> {
  const { socket } = useSocket();
  const [states, setStates] = useState<Record<string, SessionStateContext>>({});

  useEffect(() => {
    if (!socket || !projectId) return;

    function joinAndSync() {
      socket!.emit('project:join', { projectId }, (
        initialStates?: Record<string, SessionStateContext>,
      ) => {
        if (initialStates) {
          setStates(initialStates);
        }
      });
    }

    joinAndSync();

    function handleSessionState({ chatId, state }: { chatId: string; state: SessionStateContext }) {
      setStates((prev) => {
        if (state.status === 'exited') {
          const next = { ...prev };
          delete next[chatId];
          return next;
        }
        return { ...prev, [chatId]: state };
      });
    }

    socket.on('claude:session-state', handleSessionState);
    // Re-join room after reconnect (server drops room membership on disconnect)
    socket.io.on('reconnect', joinAndSync);

    return () => {
      socket.emit('project:leave', { projectId });
      socket.off('claude:session-state', handleSessionState);
      socket.io.off('reconnect', joinAndSync);
    };
  }, [socket, projectId]);

  return states;
}
