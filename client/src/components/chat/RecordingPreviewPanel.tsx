import { useEffect, useRef, useState } from 'react';
import { Card } from '../ui/card.tsx';
import { Button } from '../ui/button.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface RecordingPreviewPanelProps {
  onClose: () => void;
  onStop: (recordingId: string) => void;
}

export default function RecordingPreviewPanel({ onClose, onStop }: RecordingPreviewPanelProps) {
  const { activeRecording, stopRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<'terminal' | 'browser'>('terminal');

  const hasBrowser = (activeRecording?.browserPorts.length ?? 0) > 0;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRecording?.rawLines.length, activeRecording?.browserLines.length, tab]);

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
  const displayLines = tab === 'browser' ? activeRecording.browserLines : activeRecording.rawLines;

  return (
    <Card className="shadow-xl flex flex-col border-border-light max-h-64">
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

      {/* Tab toggle */}
      {hasBrowser && (
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('terminal')}
            className={`flex-1 text-xs py-1.5 text-center transition-colors ${tab === 'terminal' ? 'text-text font-medium border-b-2 border-primary' : 'text-text-muted hover:text-text'}`}
          >
            Terminal
          </button>
          <button
            onClick={() => setTab('browser')}
            className={`flex-1 text-xs py-1.5 text-center transition-colors ${tab === 'browser' ? 'text-text font-medium border-b-2 border-primary' : 'text-text-muted hover:text-text'}`}
          >
            Browser{activeRecording.browserLines.length > 0 ? ` (${activeRecording.browserLines.length})` : ''}
          </button>
        </div>
      )}

      {/* Output */}
      <div ref={scrollRef} className="overflow-y-auto flex-1 p-3 bg-[#0f1117] rounded-b-xl">
        <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
          {displayLines.join('\n') || (tab === 'browser' ? 'Waiting for browser logs... Refresh your app tab to start capture.' : '')}
        </pre>
      </div>

      {/* Stop button */}
      <div className="p-3 border-t border-border">
        <Button onClick={handleStop} variant="danger" className="w-full py-2 text-sm">
          Stop Recording
        </Button>
      </div>
    </Card>
  );
}
