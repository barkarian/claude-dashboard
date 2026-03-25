import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '../ui/card.tsx';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import api from '../../utils/api.ts';
import DiffViewer from './DiffViewer.tsx';
import DiffActions from './DiffActions.tsx';
import type { DiffResult, DiffFile } from '../../../../shared/types/models.ts';

interface DiffOverviewProps {
  projectId: string;
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

export default function DiffOverview({ projectId }: DiffOverviewProps) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    loadDiff();
  }, [projectId]);

  async function loadDiff() {
    setLoading(true);
    try {
      const data = await api.get<DiffResult>(`/api/projects/${projectId}/diff`);
      setDiff(data);
    } catch (err) {
      console.error('Failed to load diff:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevert(filePath: string) {
    try {
      await api.post(`/api/projects/${projectId}/revert`, { filePath });
      await loadDiff();
      if (selectedFile === filePath) setSelectedFile(null);
    } catch (err) {
      console.error('Failed to revert:', err);
    }
  }

  async function handleRevertAll() {
    if (!confirm('Revert all changes? This cannot be undone.')) return;
    try {
      await api.post(`/api/projects/${projectId}/revert`, { all: true });
      await loadDiff();
      setSelectedFile(null);
    } catch (err) {
      console.error('Failed to revert all:', err);
    }
  }

  async function handleCommit() {
    const message = prompt('Commit message:', 'Changes by Claude Code');
    if (!message) return;
    try {
      await api.post(`/api/projects/${projectId}/commit`, { message });
      await loadDiff();
      setSelectedFile(null);
    } catch (err) {
      console.error('Failed to commit:', err);
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
    return (
      <div className="flex-1 text-center pt-12">
        <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-text font-medium mb-1">No changes</h3>
        <p className="text-text-muted text-sm">Working directory is clean</p>
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
          <DiffActions filePath={selectedFile} onRevert={() => handleRevert(selectedFile)} />
        </div>
        <div className="flex-1 overflow-auto">
          <DiffViewer diff={file?.diff || ''} filePath={selectedFile} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-muted">{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
        <div className="flex gap-2">
          <Button onClick={handleRevertAll} variant="ghost" className="text-sm text-danger">Revert All</Button>
          <Button onClick={handleCommit} className="text-sm">Commit All</Button>
        </div>
      </div>

      {files.map((file) => (
        <FileChangeCard
          key={file.path}
          file={file}
          projectId={projectId}
          onSelect={() => setSelectedFile(file.path)}
          onRevert={() => handleRevert(file.path)}
        />
      ))}
    </div>
  );
}

/** Individual file card with long-press / hover popover for mobile actions. */
function FileChangeCard({
  file,
  projectId,
  onSelect,
  onRevert,
}: {
  file: DiffFile;
  projectId: string;
  onSelect: () => void;
  onRevert: () => void;
}) {
  const { open, setOpen, start, cancel, close } = useLongPress(400);

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
                  {file.status}
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
                onClick={() => { close(); onRevert(); }}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2 text-danger"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
                Revert
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
            Revert
          </Button>
        </div>
      </div>
    </Card>
  );
}
