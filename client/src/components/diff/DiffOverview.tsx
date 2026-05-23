import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Card } from '../ui/card.tsx';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import api from '../../utils/api.ts';
import DiffViewer from './DiffViewer.tsx';
import DiffActions from './DiffActions.tsx';
import PastSavesList from './PastSavesList.tsx';
import SetupSavingDrawer from '../files/SetupSavingDrawer.tsx';
import { useAIGenerate } from '../../hooks/useAIGenerate.ts';
import SendToChatDialog from '../scripts/SendToChatDialog.tsx';
import { filesStrings, fileStatusLabel, defaultSaveMessage } from '../../utils/modeStrings.ts';
import type { DiffResult, DiffFile, GitInfo, ProjectMode } from '../../../../shared/types/models.ts';

interface DiffOverviewProps {
  projectId: string;
  mode?: ProjectMode;
  repoPath?: string;
  onRepoRefresh?: () => void;
}

/** Build the download URL for a project file. */
function downloadUrl(projectId: string, filePath: string) {
  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  const base = envMatch ? envMatch[0] : '';
  return `${base}/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`;
}

/** Hook that turns a long-press / hover into a popover trigger. */
function useLongPress(delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const start = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  return { open, setOpen, start, cancel, close };
}

export default function DiffOverview({ projectId, mode = 'dev', repoPath, onRepoRefresh }: DiffOverviewProps) {
  const isSimple = mode === 'simple';
  const strings = filesStrings[mode];

  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Commit state (moved from GitPanel)
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);
  const [hasRemotes, setHasRemotes] = useState(false);
  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [showSendToChat, setShowSendToChat] = useState(false);
  const [pastSavesKey, setPastSavesKey] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const ai = useAIGenerate();

  const repoQuery = repoPath ? `?repoPath=${encodeURIComponent(repoPath)}` : '';

  useEffect(() => {
    loadDiff();
    loadGitMeta();
  }, [projectId, repoPath]);

  // When AI generates a commit message, populate the textarea
  useEffect(() => {
    if (ai.result && !ai.isGenerating) {
      setCommitMsg(ai.result);
      ai.reset();
    }
  }, [ai.result, ai.isGenerating]);

  async function loadDiff() {
    setLoading(true);
    try {
      const data = await api.get<DiffResult>(`/api/projects/${projectId}/diff${repoQuery}`);
      setDiff(data);
    } catch (err) {
      console.error('Failed to load diff:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadGitMeta() {
    try {
      const data = await api.get<GitInfo>(`/api/projects/${projectId}/git-info${repoQuery}`);
      setIsRepo(data.isRepo);
      setUnpushedCount(data.unpushedCount);
      setHasRemotes(data.remotes.length > 0);
    } catch {
      setIsRepo(false);
      setUnpushedCount(0);
      setHasRemotes(false);
    }
  }

  function handleSetupComplete() {
    setSetupOpen(false);
    loadDiff();
    loadGitMeta();
    setPastSavesKey(k => k + 1);
    onRepoRefresh?.();
  }

  async function handleRevert(filePath: string) {
    try {
      await api.post(`/api/projects/${projectId}/revert`, { filePath, repoPath });
      await loadDiff();
      onRepoRefresh?.();
      if (selectedFile === filePath) setSelectedFile(null);
    } catch (err) {
      console.error('Failed to revert:', err);
    }
  }

  async function handleRevertAll() {
    if (!confirm(strings.discardConfirm)) return;
    try {
      await api.post(`/api/projects/${projectId}/revert`, { all: true, repoPath });
      await loadDiff();
      onRepoRefresh?.();
      setSelectedFile(null);
    } catch (err) {
      console.error('Failed to revert all:', err);
    }
  }

  async function handleCommit() {
    const trimmed = commitMsg.trim();
    if (!isSimple && !trimmed) return;
    const message = trimmed || (isSimple ? defaultSaveMessage() : trimmed);
    setCommitting(true);
    try {
      await api.post(`/api/projects/${projectId}/commit`, { message, repoPath });
      setCommitMsg('');
      await loadDiff();
      if (!isSimple) await loadGitMeta();
      setPastSavesKey(k => k + 1);
      onRepoRefresh?.();
    } catch (err) {
      console.error('Failed to commit:', err);
    } finally {
      setCommitting(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    try {
      await api.post(`/api/projects/${projectId}/git-push`, { repoPath });
      await loadGitMeta();
    } catch (err) {
      console.error('Failed to push:', err);
    } finally {
      setPushing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex justify-center pt-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const files = diff?.files || [];

  if (files.length === 0) {
    const showPushEmpty = !isSimple && hasRemotes && unpushedCount > 0;
    const showSetupCta = isRepo === false;
    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="flex flex-col items-center pt-12 px-4">
          <svg className="w-12 h-12 text-text-dim mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            {showSetupCta ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            )}
          </svg>
          {showSetupCta ? (
            <>
              <h3 className="text-text font-medium mb-1">
                {isSimple ? 'Saves are off for this folder' : 'Not tracked by Git'}
              </h3>
              <p className="text-text-muted text-sm text-center max-w-xs mb-4">
                {isSimple
                  ? 'Turn on saves to keep snapshots of your work and roll back any time.'
                  : 'Initialize Git to track changes in this folder.'}
              </p>
              <Button size="sm" onClick={() => setSetupOpen(true)}>
                {isSimple ? 'Turn on Saves' : 'Initialize Git'}
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-text font-medium mb-1">{strings.nothingChangedTitle}</h3>
              <p className="text-text-muted text-sm">{strings.nothingChangedHint}</p>
            </>
          )}
          {showPushEmpty && (
            <div className="w-full max-w-xs mt-6">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePush}
                disabled={pushing}
                className="w-full"
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
                    Push {unpushedCount} commit{unpushedCount !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
        {isSimple && isRepo && (
          <div className="px-4">
            <PastSavesList projectId={projectId} repoPath={repoPath} refreshKey={pastSavesKey} />
          </div>
        )}
        <SetupSavingDrawer
          open={setupOpen}
          onOpenChange={setSetupOpen}
          projectId={projectId}
          repoPath={repoPath}
          mode={mode}
          onComplete={handleSetupComplete}
        />
      </div>
    );
  }

  if (selectedFile) {
    const file = files.find(f => f.path === selectedFile);
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
          <button
            onClick={() => setSelectedFile(null)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>
          <DiffActions mode={mode} filePath={selectedFile} onRevert={() => handleRevert(selectedFile)} />
        </div>
        <div className="flex-1 overflow-auto">
          <DiffViewer diff={file?.diff || ''} filePath={selectedFile} />
        </div>
      </div>
    );
  }

  const showPush = !isSimple && hasRemotes && unpushedCount > 0;
  const canSave = isSimple || commitMsg.trim().length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-muted">{strings.pendingHeader(files.length)}</span>
        <Button onClick={handleRevertAll} variant="ghost" className="text-sm text-danger">{strings.discardAll}</Button>
      </div>

      {files.map((file) => (
        <FileChangeCard
          key={file.path}
          file={file}
          mode={mode}
          projectId={projectId}
          repoPath={repoPath}
          onSelect={() => setSelectedFile(file.path)}
          onRevert={() => handleRevert(file.path)}
        />
      ))}

      {/* Commit Section */}
      <section className="pt-3 border-t border-border space-y-2">
        {/* Textarea with AI button inside (AI hidden in simple mode) */}
        <div className="relative">
          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder={strings.placeholder}
            rows={3}
            className={`w-full bg-bg border border-border rounded-lg px-3 py-2 ${isSimple ? '' : 'pr-10'} text-sm text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none`}
          />
          {!isSimple && (
            <button
              onClick={() => ai.generateCommitMessage(projectId, repoPath)}
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
          )}
        </div>

        {/* AI status indicator */}
        {!isSimple && ai.isGenerating && ai.step && (
          <div className="text-xs text-text-dim flex items-center gap-1.5">
            <div className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" />
            {ai.step}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isSimple && (
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
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={handleCommit} disabled={committing || !canSave} className="flex-shrink-0">
            {committing ? strings.saving : strings.saveButton}
          </Button>
        </div>

        {/* Push button (dev only) */}
        {showPush && (
          <Button
            size="sm"
            variant="outline"
            onClick={handlePush}
            disabled={pushing}
            className="w-full"
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
                Push {unpushedCount} commit{unpushedCount !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        )}
      </section>

      {isSimple && (
        <PastSavesList projectId={projectId} repoPath={repoPath} refreshKey={pastSavesKey} />
      )}

      {/* Send to Chat Dialog (dev only) */}
      {!isSimple && showSendToChat && (
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

/** Individual file card with long-press / hover popover for mobile actions. */
function FileChangeCard({
  file,
  mode,
  projectId,
  repoPath,
  onSelect,
  onRevert,
}: {
  file: DiffFile;
  mode: ProjectMode;
  projectId: string;
  repoPath?: string;
  onSelect: () => void;
  onRevert: () => void;
}) {
  const { open, setOpen, start, cancel, close } = useLongPress(400);
  const statusKey = (file.status as keyof typeof fileStatusLabel.simple) ?? 'modified';
  const statusText = fileStatusLabel[mode][statusKey] ?? file.status;

  return (
    <Card className="hover-hover:border-border-light transition-all">
      <div className="flex items-center justify-between">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={onSelect}
              onTouchStart={start}
              onTouchEnd={cancel}
              onTouchCancel={cancel}
              onMouseEnter={start}
              onMouseLeave={cancel}
              className="flex-1 text-left min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={
                  file.status === 'added' ? 'success' :
                  file.status === 'deleted' ? 'danger' :
                  'warning'
                } className="text-xs flex-shrink-0">
                  {statusText}
                </Badge>
                {/* RTL truncation: ellipsis at start, filename stays visible */}
                <span
                  className="font-mono text-sm text-text block min-w-0 overflow-hidden whitespace-nowrap text-ellipsis"
                  style={{ direction: 'rtl', textAlign: 'left' }}
                >
                  <bdi>{file.path}</bdi>
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs">
                {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
              </div>
            </button>
          </PopoverTrigger>

          <PopoverContent side="top" align="start" className="p-2 min-w-[200px] max-w-[90vw]" onInteractOutside={close}>
            {/* Full path */}
            <p className="text-xs text-text-muted font-mono break-all px-2 py-1.5 mb-1 bg-bg rounded border border-border">
              {file.path}
            </p>
            <div className="space-y-0.5">
              <button
                onClick={() => { close(); onSelect(); }}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                View
              </button>
              <button
                onClick={() => {
                  close();
                  const absolute = repoPath ? `${repoPath.replace(/\/$/, '')}/${file.path}` : file.path;
                  navigator.clipboard.writeText(absolute)
                    .then(() => toast.success('Path copied'))
                    .catch(() => toast.error('Failed to copy path'));
                }}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Copy path
              </button>
              <button
                onClick={() => { close(); onRevert(); }}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2 text-danger"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
                {filesStrings[mode].undoFile}
              </button>
              <a
                href={downloadUrl(projectId, file.path)}
                download
                onClick={close}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download
              </a>
            </div>
          </PopoverContent>
        </Popover>

        {/* Desktop quick-actions (hidden on touch via hover media query) */}
        <div className="hidden md:flex items-center gap-1 flex-shrink-0">
          <Button
            onClick={onSelect}
            variant="ghost"
            size="sm"
            className="text-xs py-1 px-2"
          >
            View
          </Button>
          <Button
            onClick={onRevert}
            variant="ghost"
            size="sm"
            className="text-xs py-1 px-2 text-danger"
          >
            {filesStrings[mode].undoFile}
          </Button>
        </div>
      </div>
    </Card>
  );
}
