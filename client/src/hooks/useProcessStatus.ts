import { useState, useEffect, useMemo } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import type { RunningProcess } from '../../../shared/types/models.ts';

interface ProcessesUpdatedPayload {
  projectId: string;
  processes: RunningProcess[];
  runningCount: number;
}

export function useProcessStatus(projectId: string | undefined) {
  const { socket } = useSocket();
  const [processes, setProcesses] = useState<RunningProcess[]>([]);
  const [runningCount, setRunningCount] = useState(0);

  useEffect(() => {
    if (!socket || !projectId) return;

    function handleUpdate({ projectId: pid, processes: procs, runningCount: count }: ProcessesUpdatedPayload) {
      if (pid !== projectId) return;
      setProcesses(procs);
      setRunningCount(count);
    }

    socket.on('processes:updated', handleUpdate);
    socket.emit('processes:list', { projectId });

    return () => {
      socket.off('processes:updated', handleUpdate);
    };
  }, [socket, projectId]);

  const processesWithPorts = useMemo(
    () => processes.filter(
      p => p.status === 'running' && p.detectedPorts && p.detectedPorts.length > 0
    ),
    [processes]
  );

  return { processes, runningCount, processesWithPorts };
}
