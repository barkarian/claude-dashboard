import { useState, useEffect } from 'react';
import api from '../../utils/api.ts';
import RecordingContentModal from './RecordingContentModal.tsx';
import type { SavedRecording } from '../../../../shared/types/models.ts';

interface SavedRecordingsPanelProps {
  projectId: string;
  onInsert: (content: string) => void;
  onClose?: () => void;
  compact?: boolean;
}

export function formatSavedRecording(rec: SavedRecording): string {
  const scriptNames = rec.scripts.map(s => s.label || s.command).join(', ');
  const duration = rec.durationSecs != null ? `${rec.durationSecs}s` : 'unknown';
  const header = `[Terminal Recording: ${scriptNames} | ${rec.lineCount} lines | ${duration}]`;
  let result = `${header}\n\`\`\`\n${rec.lines.join('\n')}\n\`\`\``;

  if (rec.browserLines.length > 0) {
    const browserHeader = `[Browser Console Logs: ${rec.browserLines.length} entries]`;
    result += `\n\n${browserHeader}\n\`\`\`\n${rec.browserLines.join('\n')}\n\`\`\``;
  }

  return result;
}

export function buildRecordingHeader(rec: SavedRecording): string {
  const scriptNames = rec.scripts.map(s => s.label || s.command).join(', ');
  const duration = rec.durationSecs != null ? `${rec.durationSecs}s` : 'unknown';
  return `[Terminal Recording: ${scriptNames} | ${rec.lineCount} lines | ${duration}]`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SavedRecordingsPanel({ projectId, onInsert, onClose, compact }: SavedRecordingsPanelProps) {
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewRecordingId, setViewRecordingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<{ recordings: SavedRecording[] }>(`/api/projects/${projectId}/recordings`)
      .then(res => setRecordings(res.recordings || []))
      .catch(() => setRecordings([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await api.delete(`/api/projects/${projectId}/recordings/${id}`);
      setRecordings(prev => prev.filter(r => r.id !== id));
    } catch { /* silent */ }
    setDeletingId(null);
  }

  function handleInsert(rec: SavedRecording) {
    const content = formatSavedRecording(rec);
    onInsert(content);
    onClose?.();
  }

  if (loading) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-muted">
        Loading saved recordings...
      </div>
    );
  }

  if (recordings.length === 0) return null;

  return (
    <>
      <div className={compact ? '' : 'border-t border-border'}>
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
            Saved Recordings
          </span>
          <span className="text-[10px] text-text-dim">{recordings.length}</span>
        </div>
        <div className={compact ? 'max-h-48 overflow-y-auto' : ''}>
          {recordings.map(rec => {
            const names = rec.scripts.map(s => s.label || s.command).join(', ');
            const isDeleting = deletingId === rec.id;
            return (
              <div
                key={rec.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-bg-hover transition-colors group"
              >
                <button
                  onClick={() => setViewRecordingId(rec.id)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  <svg className="w-3.5 h-3.5 text-danger flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                  </svg>
                  <span className="text-sm truncate">{names}</span>
                  <span className="text-xs text-text-muted flex-shrink-0">{rec.lineCount} lines</span>
                  <span className="text-[10px] text-text-dim flex-shrink-0">{timeAgo(rec.createdAt)}</span>
                </button>

                {/* Add to Chat */}
                <button
                  onClick={() => handleInsert(rec)}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-bg-hover transition-all flex-shrink-0"
                  aria-label="Add to chat"
                  title="Add to chat"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(rec.id)}
                  disabled={isDeleting}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-bg-hover transition-all flex-shrink-0 disabled:opacity-30"
                  aria-label="Delete recording"
                  title="Delete recording"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* View modal */}
      {viewRecordingId && (() => {
        const rec = recordings.find(r => r.id === viewRecordingId);
        if (!rec) return null;
        const content = formatSavedRecording(rec);
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setViewRecordingId(null)}>
            <div className="bg-bg-surface border border-border rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border">
                <span className="text-sm font-medium">Saved Recording</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { handleInsert(rec); setViewRecordingId(null); }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
                  >
                    Add to Chat
                  </button>
                  <button onClick={() => setViewRecordingId(null)} className="p-1 rounded hover:bg-bg-hover">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto p-4">
                <pre className="text-xs font-mono text-text whitespace-pre-wrap break-all">{content}</pre>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
