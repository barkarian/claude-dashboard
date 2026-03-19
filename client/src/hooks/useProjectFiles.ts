import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext.tsx';

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

    function handleFilesChanged() {
      socket!.emit('files:list', { projectId });
    }

    socket.on('files:list', handleFileList);
    socket.on('files:changed', handleFilesChanged);

    // Initial fetch and start watching
    socket.emit('files:list', { projectId });
    socket.emit('files:watch-start', { projectId });

    return () => {
      socket.off('files:list', handleFileList);
      socket.off('files:changed', handleFilesChanged);
      socket.emit('files:watch-stop', { projectId });
    };
  }, [socket, projectId]);

  return { files, loading, refresh };
}
