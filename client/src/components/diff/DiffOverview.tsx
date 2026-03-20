import { useState, useEffect } from 'react';
import { Card } from '../ui/card.tsx';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';
import DiffViewer from './DiffViewer.tsx';
import DiffActions from './DiffActions.tsx';
import type { DiffResult, DiffFile } from '../../../../shared/types/models.ts';

interface DiffOverviewProps {
  projectId: string;
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
        <Card key={file.path} className="hover-hover:border-border-light transition-all">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedFile(file.path)}
              className="flex-1 text-left min-w-0"
            >
              <div className="flex items-center gap-2">
                <Badge variant={
                  file.status === 'added' ? 'success' :
                  file.status === 'deleted' ? 'danger' :
                  'warning'
                } className="text-xs">
                  {file.status}
                </Badge>
                <span className="font-mono text-sm text-text truncate">{file.path}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs">
                {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
              </div>
            </button>

            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                onClick={() => setSelectedFile(file.path)}
                variant="ghost"
                size="sm"
                className="text-xs py-1 px-2"
              >
                View
              </Button>
              <Button
                onClick={() => handleRevert(file.path)}
                variant="ghost"
                size="sm"
                className="text-xs py-1 px-2 text-danger"
              >
                Revert
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
