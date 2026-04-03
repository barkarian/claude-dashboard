import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import type { SessionStatus } from '../../../shared/types/interactive.ts';
import type { SessionStateContext } from '../../../shared/types/session.ts';

export function useSessionStatuses(projectId: string | undefined): Record<string, SessionStatus> {
  const { socket } = useSocket();
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});

  useEffect(() => {
    if (!socket || !projectId) return;

    function joinAndSync() {
      socket!.emit('project:join', { projectId }, (initial: Record<string, SessionStatus>) => {
        setStatuses(initial || {});
      });
    }

    joinAndSync();

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
    // Re-join room after reconnect (server drops room membership on disconnect)
    socket.io.on('reconnect', joinAndSync);

    return () => {
      socket.emit('project:leave', { projectId });
      socket.off('claude:session-status', handleSessionStatus);
      socket.io.off('reconnect', joinAndSync);
    };
  }, [socket, projectId]);

  return statuses;
}

/**
 * Unified session states from the JSONL watcher.
 * Returns rich SessionStateContext for each active chat.
 */
export function useSessionStates(projectId: string | undefined): Record<string, SessionStateContext> {
  const { socket } = useSocket();
  const [states, setStates] = useState<Record<string, SessionStateContext>>({});

  useEffect(() => {
    if (!socket || !projectId) return;

    function joinAndSync() {
      // project:join callback includes session states as second arg
      socket!.emit('project:join', { projectId }, (
        _statuses: Record<string, string>,
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
      socket.off('claude:session-state', handleSessionState);
      socket.io.off('reconnect', joinAndSync);
    };
  }, [socket, projectId]);

  return states;
}
