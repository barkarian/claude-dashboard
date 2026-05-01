import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import api from '../../utils/api.ts';
import { timeAgo } from '../../utils/timeAgo.ts';
import SetupSavingDrawer from '../files/SetupSavingDrawer.tsx';
import type { GitInfo, GitRemote, GitLogEntry } from '../../../../shared/types/models.ts';

interface GitPanelProps {
  projectId: string;
  repoPath?: string;
}

interface GitHubRepoResult {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  private: boolean;
}

function formatRemoteUrl(url: string): { href: string | null; display: string } {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { href: `https://${sshMatch[1]}/${sshMatch[2]}`, display: url };
  }
  if (url.startsWith('https://') || url.startsWith('http://')) {
    return { href: url.replace(/\.git$/, ''), display: url };
  }
  return { href: null, display: url };
}

export default function GitPanel({ projectId, repoPath }: GitPanelProps) {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [showAddRemote, setShowAddRemote] = useState(false);
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [addingRemote, setAddingRemote] = useState(false);
  // GitHub repo search
  const [ghSearch, setGhSearch] = useState('');
  const [ghResults, setGhResults] = useState<GitHubRepoResult[]>([]);
  const [ghSearching, setGhSearching] = useState(false);
  const ghTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const repoQuery = repoPath ? `?repoPath=${encodeURIComponent(repoPath)}` : '';

  const loadGitInfo = useCallback(async () => {
    try {
      const data = await api.get<GitInfo>(`/api/projects/${projectId}/git-info${repoQuery}`);
      setGitInfo(data);
    } catch (err) {
      console.error('Failed to load git info:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, repoQuery]);

  useEffect(() => {
    loadGitInfo();
  }, [loadGitInfo]);

  // Debounced GitHub search
  useEffect(() => {
    if (!ghSearch.trim()) {
      setGhResults([]);
      return;
    }
    if (ghTimerRef.current) clearTimeout(ghTimerRef.current);
    ghTimerRef.current = setTimeout(async () => {
      setGhSearching(true);
      try {
        const data = await api.get<{ repos: GitHubRepoResult[] }>(
          `/api/projects/${projectId}/github-repos?q=${encodeURIComponent(ghSearch.trim())}`
        );
        setGhResults(data.repos || []);
      } catch {
        setGhResults([]);
      } finally {
        setGhSearching(false);
      }
    }, 400);
    return () => { if (ghTimerRef.current) clearTimeout(ghTimerRef.current); };
  }, [ghSearch, projectId]);

  function handleSetupComplete() {
    setSetupOpen(false);
    loadGitInfo();
  }

  async function handleAddRemote() {
    if (!remoteName.trim() || !remoteUrl.trim()) return;
    setAddingRemote(true);
    try {
      await api.post(`/api/projects/${projectId}/git-remote`, { name: remoteName.trim(), url: remoteUrl.trim(), repoPath });
      setRemoteName('');
      setRemoteUrl('');
      setGhSearch('');
      setGhResults([]);
      setShowAddRemote(false);
      await loadGitInfo();
    } catch (err) {
      console.error('Failed to add remote:', err);
    } finally {
      setAddingRemote(false);
    }
  }

  function handleSelectGhRepo(repo: GitHubRepoResult) {
    setRemoteUrl(repo.url);
    if (!remoteName.trim()) setRemoteName('origin');
    setGhSearch('');
    setGhResults([]);
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // No-repo state
  if (!gitInfo?.isRepo) {
    return (
      <>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <svg className="w-12 h-12 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <p className="text-sm text-text-muted">No git repository found</p>
          <Button onClick={() => setSetupOpen(true)} size="sm">
            Initialize Git Repository
          </Button>
        </div>
        <SetupSavingDrawer
          open={setupOpen}
          onOpenChange={setSetupOpen}
          projectId={projectId}
          repoPath={repoPath}
          mode="dev"
          onComplete={handleSetupComplete}
        />
      </>
    );
  }

  const hasRemotes = gitInfo.remotes.length > 0;

  // Repo state
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6">
      {/* Branch indicator */}
      {gitInfo.branch && (
        <div className="flex items-center gap-2 text-xs text-text-dim">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          <span className="font-mono truncate">{gitInfo.branch}</span>
          {hasRemotes && gitInfo.unpushedCount > 0 && (
            <span className="text-warning flex-shrink-0">({gitInfo.unpushedCount} unpushed)</span>
          )}
        </div>
      )}

      {/* Remotes Section */}
      <section className="min-w-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-text-dim uppercase tracking-wider">Remotes</h3>
          <button
            onClick={() => setShowAddRemote(!showAddRemote)}
            className="text-xs text-primary hover:text-primary/80 transition-colors flex-shrink-0"
          >
            {showAddRemote ? 'Cancel' : 'Add Remote'}
          </button>
        </div>

        {gitInfo.remotes.length === 0 && !showAddRemote && (
          <p className="text-sm text-text-muted">No remotes configured</p>
        )}

        {gitInfo.remotes.map((remote: GitRemote) => {
          const { href, display } = formatRemoteUrl(remote.url);
          return (
            <div key={remote.name} className="flex items-center gap-2 py-1.5 text-sm min-w-0">
              <span className="font-mono text-primary text-xs flex-shrink-0">{remote.name}</span>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-primary truncate transition-colors min-w-0"
                >
                  {display}
                </a>
              ) : (
                <span className="text-text-muted truncate min-w-0">{display}</span>
              )}
            </div>
          );
        })}

        {showAddRemote && (
          <div className="mt-2 space-y-2">
            {/* GitHub search (only if token detected) */}
            {gitInfo.hasGithubToken && (
              <div className="relative">
                <Input
                  value={ghSearch}
                  onChange={(e) => setGhSearch(e.target.value)}
                  placeholder="Search GitHub repos..."
                  className="text-sm py-1"
                />
                {ghSearching && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                )}
                {ghResults.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-surface border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {ghResults.map((repo) => (
                      <button
                        key={repo.fullName}
                        onClick={() => handleSelectGhRepo(repo)}
                        className="w-full text-left px-3 py-2 hover:bg-bg-hover transition-colors border-b border-border last:border-0"
                      >
                        <div className="text-sm text-text truncate">{repo.fullName}</div>
                        {repo.description && (
                          <div className="text-xs text-text-dim truncate">{repo.description}</div>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          {repo.language && <span className="text-xs text-text-muted">{repo.language}</span>}
                          {repo.private && <span className="text-xs text-warning">private</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={remoteName}
                onChange={(e) => setRemoteName(e.target.value)}
                placeholder="name"
                className="text-sm py-1 w-20 flex-shrink-0"
              />
              <Input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/..."
                className="text-sm py-1 flex-1 min-w-0"
              />
              <Button size="sm" onClick={handleAddRemote} disabled={addingRemote || !remoteName.trim() || !remoteUrl.trim()}>
                Add
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Log Section */}
      <section className="min-w-0">
        <h3 className="text-xs font-medium text-text-dim uppercase tracking-wider mb-2">History</h3>
        {gitInfo.log.length === 0 ? (
          <p className="text-sm text-text-muted">No commits yet</p>
        ) : (
          <div className="space-y-0.5">
            {gitInfo.log.map((entry: GitLogEntry) => (
              <div key={entry.hash} className="py-1.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-mono text-xs text-primary flex-shrink-0">{entry.shortHash}</span>
                  <span className="text-sm text-text truncate flex-1 min-w-0">{entry.message}</span>
                  <span className="text-xs text-text-dim flex-shrink-0 whitespace-nowrap">
                    {timeAgo(entry.date)}
                  </span>
                </div>
                {/* Change stats */}
                <div className="flex items-center gap-2 ml-[calc(7ch+0.5rem)] text-xs mt-0.5">
                  {entry.filesChanged > 0 && (
                    <span className="text-text-dim">{entry.filesChanged} file{entry.filesChanged !== 1 ? 's' : ''}</span>
                  )}
                  {entry.additions > 0 && <span className="text-success">+{entry.additions}</span>}
                  {entry.deletions > 0 && <span className="text-danger">-{entry.deletions}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
