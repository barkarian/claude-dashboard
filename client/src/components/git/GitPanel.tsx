import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import api from '../../utils/api.ts';
import { useAIGenerate } from '../../hooks/useAIGenerate.ts';
import SendToChatDialog from '../scripts/SendToChatDialog.tsx';
import type { GitInfo, GitRemote, GitLogEntry } from '../../../../shared/types/models.ts';

interface GitPanelProps {
  projectId: string;
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

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function GitPanel({ projectId }: GitPanelProps) {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [showAddRemote, setShowAddRemote] = useState(false);
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [addingRemote, setAddingRemote] = useState(false);
  const [showSendToChat, setShowSendToChat] = useState(false);
  // GitHub repo search
  const [ghSearch, setGhSearch] = useState('');
  const [ghResults, setGhResults] = useState<GitHubRepoResult[]>([]);
  const [ghSearching, setGhSearching] = useState(false);
  const ghTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ai = useAIGenerate();

  const loadGitInfo = useCallback(async () => {
    try {
      const data = await api.get<GitInfo>(`/api/projects/${projectId}/git-info`);
      setGitInfo(data);
    } catch (err) {
      console.error('Failed to load git info:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadGitInfo();
  }, [loadGitInfo]);

  // When AI generates a commit message, populate the textarea
  useEffect(() => {
    if (ai.result && !ai.isGenerating) {
      setCommitMsg(ai.result);
      ai.reset();
    }
  }, [ai.result, ai.isGenerating]);

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

  async function handleInit() {
    try {
      await api.post(`/api/projects/${projectId}/git-init`);
      await loadGitInfo();
    } catch (err) {
      console.error('Failed to init git:', err);
    }
  }

  async function handleCommit() {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      await api.post(`/api/projects/${projectId}/commit`, { message: commitMsg.trim() });
      setCommitMsg('');
      await loadGitInfo();
    } catch (err) {
      console.error('Failed to commit:', err);
    } finally {
      setCommitting(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    try {
      await api.post(`/api/projects/${projectId}/git-push`);
      await loadGitInfo();
    } catch (err) {
      console.error('Failed to push:', err);
    } finally {
      setPushing(false);
    }
  }

  async function handleAddRemote() {
    if (!remoteName.trim() || !remoteUrl.trim()) return;
    setAddingRemote(true);
    try {
      await api.post(`/api/projects/${projectId}/git-remote`, { name: remoteName.trim(), url: remoteUrl.trim() });
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
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <svg className="w-12 h-12 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <p className="text-sm text-text-muted">No git repository found</p>
        <Button onClick={handleInit} size="sm">
          Initialize Git Repository
        </Button>
      </div>
    );
  }

  const hasRemotes = gitInfo.remotes.length > 0;
  const showPush = hasRemotes && gitInfo.unpushedCount > 0;

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
          {showPush && (
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

      {/* Commit Section */}
      <section className="min-w-0">
        <h3 className="text-xs font-medium text-text-dim uppercase tracking-wider mb-2">Commit</h3>

        {/* Textarea with AI button inside */}
        <div className="relative mb-2">
          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            rows={3}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 pr-10 text-sm text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none"
          />
          {/* AI generate button inside textarea */}
          <button
            onClick={() => ai.generateCommitMessage(projectId)}
            disabled={ai.isGenerating}
            className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-bg-hover transition-colors text-text-dim hover:text-primary disabled:opacity-50"
            title="Generate with AI"
          >
            {ai.isGenerating ? (
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
            )}
          </button>
        </div>

        {/* AI status indicator */}
        {ai.isGenerating && ai.step && (
          <div className="text-xs text-text-dim mb-2 flex items-center gap-1.5">
            <div className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" />
            {ai.step}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSendToChat(true)}
            className="flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
            Commit via Chat
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={handleCommit} disabled={committing || !commitMsg.trim()} className="flex-shrink-0">
            {committing ? 'Committing...' : 'Commit'}
          </Button>
        </div>

        {/* Push button */}
        {showPush && (
          <Button
            size="sm"
            variant="outline"
            onClick={handlePush}
            disabled={pushing}
            className="w-full mt-2"
          >
            {pushing ? (
              <>
                <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full mr-1.5" />
                Pushing...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Push {gitInfo.unpushedCount} commit{gitInfo.unpushedCount !== 1 ? 's' : ''}
              </>
            )}
          </Button>
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

      {/* Send to Chat Dialog */}
      {showSendToChat && (
        <SendToChatDialog
          projectId={projectId}
          content="commit the changes that we made until this point in this Chat, do not commit again in the future if I am not explicitly tell you to do that.."
          contentLabel="Commit Request"
          rawContent
          onClose={() => setShowSendToChat(false)}
        />
      )}
    </div>
  );
}
