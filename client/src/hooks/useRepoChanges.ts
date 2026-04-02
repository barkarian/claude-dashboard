import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import api from '../utils/api.ts';
import type { RepoInfo } from '../../../shared/types/models.ts';

interface UseRepoChangesReturn {
  repos: RepoInfo[];
  selectedRepo: RepoInfo | null;
  setSelectedRepo: (repo: RepoInfo) => void;
  totalChangeCount: number;
  loading: boolean;
  refresh: () => void;
}

export function useRepoChanges(projectId: string): UseRepoChangesReturn {
  const { socket } = useSocket();
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepoState] = useState<RepoInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const totalChangeCount = repos.reduce((sum, r) => sum + r.changeCount, 0);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ repos: RepoInfo[] }>(`/api/projects/${projectId}/repos`);
      setRepos(data.repos);
      setSelectedRepoState(prev => {
        if (prev) {
          const match = data.repos.find(r => r.repoPath === prev.repoPath);
          if (match) return match;
        }
        return data.repos[0] || null;
      });
    } catch {
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for real-time change count updates
  useEffect(() => {
    if (!socket) return;

    function handleChangeCounts({ projectId: pid, repos: updatedRepos }: { projectId: string; repos: RepoInfo[]; totalChangeCount: number }) {
      if (pid !== projectId) return;
      setRepos(updatedRepos);
      setSelectedRepoState(prev => {
        if (prev) {
          const match = updatedRepos.find(r => r.repoPath === prev.repoPath);
          if (match) return match;
        }
        return updatedRepos[0] || null;
      });
    }

    socket.on('repos:change-counts', handleChangeCounts);
    return () => { socket.off('repos:change-counts', handleChangeCounts); };
  }, [socket, projectId]);

  const setSelectedRepo = useCallback((repo: RepoInfo) => {
    setSelectedRepoState(repo);
  }, []);

  return { repos, selectedRepo, setSelectedRepo, totalChangeCount, loading, refresh };
}
