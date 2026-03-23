import { useState, useEffect, useRef } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { Button } from '../ui/button.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';

interface DesktopRecordingControlsProps {
  projectId: string;
}

export default function DesktopRecordingControls({ projectId }: DesktopRecordingControlsProps) {
  const { activeRecording, recordings, stopRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<'terminal' | 'browser'>('terminal');

  const [showPanel, setShowPanel] = useState(false);
  const [stoppedIds, setStoppedIds] = useState<string[]>([]);
  const [viewRecordingId, setViewRecordingId] = useState<string | null>(null);
  const [showScriptPicker, setShowScriptPicker] = useState(false);

  // Elapsed timer
  useEffect(() => {
    if (!activeRecording) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - activeRecording.startedAt) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeRecording.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRecording]);

  // Auto-scroll live output
  useEffect(() => {
    if (scrollRef.current && showPanel && activeRecording) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRecording?.rawLines.length, activeRecording?.browserLines.length, tab, showPanel]);

  // When a new recording starts, hide script picker
  useEffect(() => {
    if (activeRecording) {
      setShowScriptPicker(false);
    }
  }, [activeRecording]);

  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function handleStop() {
    const id = stopRecording();
    if (id) {
      setStoppedIds(prev => [...prev, id]);
    }
  }

  function dismissRecording(id: string) {
    setStoppedIds(prev => prev.filter(i => i !== id));
  }

  const hasBrowser = activeRecording ? activeRecording.browserPorts.length > 0 : false;
  const displayLines = activeRecording
    ? (tab === 'browser' ? activeRecording.browserLines : activeRecording.rawLines)
    : [];

  // Filter to only IDs that still exist in recordings map
  const validStoppedIds = stoppedIds.filter(id => recordings.has(id));

  return (
    <>
      <Popover open={showPanel} onOpenChange={(open) => {
        setShowPanel(open);
        if (!open) setShowScriptPicker(false);
      }}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors flex-shrink-0"
            title="Terminal recording"
          >
            {activeRecording ? (
              <>
                <span className="recording-pulse w-2 h-2 rounded-full bg-danger" />
                <span className="text-xs font-medium text-danger">{formatTime(elapsed)}</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-danger" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="7" />
                </svg>
                {validStoppedIds.length > 0 && (
                  <span className="text-[10px] font-medium text-text-muted bg-bg-surface border border-border rounded-full w-4 h-4 flex items-center justify-center">
                    {validStoppedIds.length}
                  </span>
                )}
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="p-0 w-[420px] flex flex-col" style={{ maxHeight: '480px' }}>
          {/* ── Live recording section ── */}
          {activeRecording && (
            <>
              <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="recording-pulse w-2.5 h-2.5 rounded-full bg-danger flex-shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {activeRecording.scripts.map(s => s.label || s.command).join(', ')}
                  </span>
                  <span className="text-xs text-text-muted flex-shrink-0">
                    {formatTime(elapsed)} &middot; {activeRecording.lineCount} lines
                  </span>
                </div>
              </div>

              {hasBrowser && (
                <div className="flex border-b border-border flex-shrink-0">
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

              <div ref={scrollRef} className="overflow-y-auto flex-1 min-h-0 p-3 bg-[#0f1117]" style={{ minHeight: '120px' }}>
                <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
                  {displayLines.join('\n') || (tab === 'browser' ? 'Waiting for browser logs... Refresh your app tab to start capture.' : '')}
                </pre>
              </div>

              <div className="p-3 border-t border-border flex-shrink-0">
                <Button onClick={handleStop} variant="danger" className="w-full py-2 text-sm">
                  Stop Recording
                </Button>
              </div>
            </>
          )}

          {/* ── Stopped recordings list ── */}
          {validStoppedIds.length > 0 && (
            <div className={activeRecording ? 'border-t border-border' : ''}>
              <div className="px-3 pt-3 pb-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider">
                Recorded Logs
              </div>
              {validStoppedIds.map(id => {
                const rec = recordings.get(id);
                if (!rec) return null;
                const names = rec.scripts.map(s => s.label || s.command).join(', ');
                const count = rec.lines.length;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-bg-hover transition-colors group"
                  >
                    <button
                      onClick={() => { setViewRecordingId(id); setShowPanel(false); }}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      <svg className="w-3.5 h-3.5 text-danger flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                      </svg>
                      <span className="text-sm truncate">{names}</span>
                      <span className="text-xs text-text-muted flex-shrink-0">{count} lines</span>
                    </button>
                    <button
                      onClick={() => dismissRecording(id)}
                      className="w-5 h-5 flex items-center justify-center rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-text-muted hover:bg-bg-hover transition-all flex-shrink-0"
                      aria-label="Dismiss"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── New Recording / Script Picker ── */}
          {!activeRecording && (
            <div className={validStoppedIds.length > 0 || activeRecording ? 'border-t border-border' : ''}>
              {showScriptPicker ? (
                <ScriptPickerPanel
                  projectId={projectId}
                  onClose={() => setShowScriptPicker(false)}
                  onStarted={() => setShowScriptPicker(false)}
                />
              ) : (
                <div className="p-3">
                  <button
                    onClick={() => setShowScriptPicker(true)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
                  >
                    <svg className="w-4 h-4 text-danger" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="7" />
                    </svg>
                    New Recording
                  </button>
                </div>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Recording content modal (rendered outside popover) */}
      {viewRecordingId && (
        <RecordingContentModal
          recordingId={viewRecordingId}
          onClose={() => setViewRecordingId(null)}
        />
      )}
    </>
  );
}
