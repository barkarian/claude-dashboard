import { useEffect, useState } from 'react';
import api from '../../utils/api.ts';
import { timeAgo } from '../../utils/timeAgo.ts';
import { filesStrings } from '../../utils/modeStrings.ts';
import type { GitInfo, GitLogEntry } from '../../../../shared/types/models.ts';

interface PastSavesListProps {
  projectId: string;
  repoPath?: string;
  refreshKey?: number;
}

export default function PastSavesList({ projectId, repoPath, refreshKey = 0 }: PastSavesListProps) {
  const [log, setLog] = useState<GitLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const repoQuery = repoPath ? `?repoPath=${encodeURIComponent(repoPath)}` : '';
    setLoading(true);
    api.get<GitInfo>(`/api/projects/${projectId}/git-info${repoQuery}`)
      .then((data) => {
        if (cancelled) return;
        setLog(data.isRepo ? data.log : []);
      })
      .catch(() => {
        if (cancelled) return;
        setLog([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId, repoPath, refreshKey]);

  if (loading) return null;
  if (!log || log.length === 0) return null;

  return (
    <section className="pt-4 mt-2 border-t border-border min-w-0">
      <h3 className="text-xs font-medium text-text-dim uppercase tracking-wider mb-2">
        {filesStrings.simple.pastSavesHeader}
      </h3>
      <div className="space-y-0.5">
        {log.map((entry) => (
          <div key={entry.hash} className="py-1.5">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm text-text truncate flex-1 min-w-0">{entry.message}</span>
              <span className="text-xs text-text-dim flex-shrink-0 whitespace-nowrap">
                {timeAgo(entry.date)}
              </span>
            </div>
            {entry.filesChanged > 0 && (
              <div className="text-xs text-text-dim mt-0.5">
                {entry.filesChanged} file{entry.filesChanged !== 1 ? 's' : ''} saved
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
