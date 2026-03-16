import { useEffect, useRef, useState } from 'react';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import type { AppActivityEventUnion } from '../../../../shared/types/appActivity.ts';

interface RecordingContentModalProps {
  recordingId: string;
  onClose: () => void;
}

function formatActivityEvent(evt: AppActivityEventUnion): string {
  const time = new Date(evt.ts).toISOString().slice(11, 23);
  if (evt.type === 'console') {
    return `[${time}] console.${evt.level}: ${evt.args.join(' ')}`;
  }
  if (evt.type === 'network') {
    return `[${time}] ${evt.method} ${evt.url} → ${evt.status} (${evt.durationMs}ms)`;
  }
  if (evt.type === 'error') {
    return `[${time}] ERROR: ${evt.message}`;
  }
  return `[${time}] ${evt.type}`;
}

export default function RecordingContentModal({ recordingId, onClose }: RecordingContentModalProps) {
  const { recordings, activeRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'terminal' | 'activity'>('terminal');

  // Use active recording if ID matches, otherwise look in completed recordings
  const isLive = activeRecording?.id === recordingId;
  const rec = isLive ? activeRecording : recordings.get(recordingId);

  const activityEvents: AppActivityEventUnion[] = rec?.activityEvents || [];
  const hasActivity = activityEvents.length > 0;

  // Auto-scroll for live recordings
  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isLive, rec?.rawLines.length, activityEvents.length]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!rec) return null;

  const scriptNames = rec.scripts.map(s => s.label || s.command).join(', ');
  const lineCount = rec.lines.length;
  const startTime = new Date(rec.startedAt).toLocaleTimeString();
  const stoppedAt = !isLive && 'stoppedAt' in rec && rec.stoppedAt
    ? new Date(rec.stoppedAt).toLocaleTimeString()
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-bg-surface border border-border rounded-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              {isLive && <span className="recording-pulse w-2.5 h-2.5 rounded-full bg-danger" />}
              <span className="font-medium text-sm">{scriptNames}</span>
            </div>
            <div className="text-xs text-text-muted mt-1">
              {lineCount} lines
              {hasActivity && ` · ${activityEvents.length} activity events`}
              {' · '}{startTime}
              {stoppedAt ? ` - ${stoppedAt}` : ' - now'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors text-text-muted"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar (only show if there are activity events) */}
        {hasActivity && (
          <div className="flex border-b border-border">
            <button
              onClick={() => setTab('terminal')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'terminal'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Terminal ({lineCount})
            </button>
            <button
              onClick={() => setTab('activity')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'activity'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              App Activity ({activityEvents.length})
            </button>
          </div>
        )}

        {/* Content */}
        <div ref={scrollRef} className="overflow-y-auto flex-1 p-4 bg-[#0f1117]">
          {tab === 'terminal' ? (
            <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
              {rec.rawLines.join('\n')}
            </pre>
          ) : (
            <div className="space-y-0.5">
              {activityEvents.map((evt, i) => (
                <div
                  key={i}
                  className={`text-xs font-mono whitespace-pre-wrap break-all ${
                    evt.type === 'error' ? 'text-red-400' :
                    evt.type === 'console' && evt.level === 'warn' ? 'text-yellow-400' :
                    evt.type === 'console' && evt.level === 'error' ? 'text-red-400' :
                    evt.type === 'network' && evt.status >= 400 ? 'text-red-400' :
                    'text-[#e2e8f0]'
                  }`}
                >
                  {formatActivityEvent(evt)}
                </div>
              ))}
              {activityEvents.length === 0 && (
                <div className="text-xs text-text-muted text-center py-4">
                  No activity events captured yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
