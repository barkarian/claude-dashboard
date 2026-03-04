import { useEffect, useRef } from 'react';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface RecordingContentModalProps {
  recordingId: string;
  onClose: () => void;
}

export default function RecordingContentModal({ recordingId, onClose }: RecordingContentModalProps) {
  const { recordings, activeRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Use active recording if ID matches, otherwise look in completed recordings
  const isLive = activeRecording?.id === recordingId;
  const rec = isLive ? activeRecording : recordings.get(recordingId);

  // Auto-scroll for live recordings
  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isLive, rec?.rawLines.length]);

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
              {lineCount} lines &middot; {startTime}
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

        {/* Content */}
        <div ref={scrollRef} className="overflow-y-auto flex-1 p-4 bg-[#0f1117]">
          <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
            {rec.rawLines.join('\n')}
          </pre>
        </div>
      </div>
    </div>
  );
}
