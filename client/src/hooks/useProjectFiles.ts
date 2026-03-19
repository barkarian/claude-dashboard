import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext.tsx';

interface BatchChange {
  event: string;
  path: string;
}

export function useProjectFiles(projectId: string) {
  const { socket } = useSocket();
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!socket) return;
    setLoading(true);
    socket.emit('files:list', { projectId });
  }, [socket, projectId]);

  useEffect(() => {
    if (!socket) return;

    function handleFileList({ files: fileList }: { files: string[] }) {
      setFiles(fileList);
      setLoading(false);
    }

    function handleBatchChanged({ changes }: { projectId: string; changes: BatchChange[] }) {
      setFiles((prev) => {
        let next = prev;
        let changed = false;
        for (const { event, path: filePath } of changes) {
          if (event === 'add' && !next.includes(filePath)) {
            next = changed ? next : [...next];
            next.push(filePath);
            changed = true;
          } else if (event === 'unlink') {
            const filtered = next.filter(f => f !== filePath);
            if (filtered.length !== next.length) {
              next = filtered;
              changed = true;
            }
          }
        }
        return changed ? next.sort() : prev;
      });
    }

    function handleRefresh() {
      socket!.emit('files:list', { projectId });
    }

    socket.on('files:list', handleFileList);
    socket.on('files:changed-batch', handleBatchChanged);
    socket.on('files:refresh', handleRefresh);

    // Initial fetch and start watching
    socket.emit('files:list', { projectId });
    socket.emit('files:watch-start', { projectId });

    return () => {
      socket.off('files:list', handleFileList);
      socket.off('files:changed-batch', handleBatchChanged);
      socket.off('files:refresh', handleRefresh);
      socket.emit('files:watch-stop', { projectId });
    };
  }, [socket, projectId]);

  return { files, loading, refresh };
}
