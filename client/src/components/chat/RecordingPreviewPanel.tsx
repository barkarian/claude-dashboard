import { useEffect, useRef, useState } from 'react';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface RecordingPreviewPanelProps {
  onClose: () => void;
  onStop: (recordingId: string) => void;
}

export default function RecordingPreviewPanel({ onClose, onStop }: RecordingPreviewPanelProps) {
  const { activeRecording, stopRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRecording?.rawLines.length]);

  // Elapsed timer
  useEffect(() => {
    if (!activeRecording) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeRecording.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRecording]);

  if (!activeRecording) return null;

  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function handleStop() {
    const id = stopRecording();
    if (id) onStop(id);
  }

  const scriptNames = activeRecording.scripts.map(s => s.label || s.command).join(', ');

  return (
    <div className="card shadow-xl flex flex-col border-border-light max-h-64">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="recording-pulse w-2.5 h-2.5 rounded-full bg-danger flex-shrink-0" />
          <span className="text-sm font-medium truncate">{scriptNames}</span>
          <span className="text-xs text-text-muted flex-shrink-0">
            {formatTime(elapsed)} &middot; {activeRecording.lineCount} lines
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors text-text-muted"
            aria-label="Minimize"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal output */}
      <div ref={scrollRef} className="overflow-y-auto flex-1 p-3 bg-[#0f1117] rounded-b-xl">
        <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
          {activeRecording.rawLines.join('\n')}
        </pre>
      </div>

      {/* Stop button */}
      <div className="p-3 border-t border-border">
        <button onClick={handleStop} className="btn-danger w-full py-2 text-sm">
          Stop Recording
        </button>
      </div>
    </div>
  );
}
