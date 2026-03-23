import { useState, useEffect, useRef } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { Button } from '../ui/button.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';

interface DesktopRecordingControlsProps {
  projectId: string;
}

export default function DesktopRecordingControls({ projectId }: DesktopRecordingControlsProps) {
  const { activeRecording, recordings, stopRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<'terminal' | 'browser'>('terminal');

  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [showLivePanel, setShowLivePanel] = useState(false);
  const [stoppedRecordingId, setStoppedRecordingId] = useState<string | null>(null);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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
    if (scrollRef.current && showLivePanel) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRecording?.rawLines.length, activeRecording?.browserLines.length, tab, showLivePanel]);

  // Clear stopped state when new recording starts
  useEffect(() => {
    if (activeRecording) {
      setStoppedRecordingId(null);
      setShowCopyMenu(false);
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
      setStoppedRecordingId(id);
      setShowLivePanel(false);
      setShowCopyMenu(true);
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // silent fail
    }
  }

  function handleCopyAll() {
    if (!stoppedRecordingId) return;
    const rec = recordings.get(stoppedRecordingId);
    if (!rec) return;
    let content = rec.lines.join('\n');
    if (rec.browserLines.length > 0) {
      content += '\n\n--- Browser Console Logs ---\n' + rec.browserLines.join('\n');
    }
    copyToClipboard(content, 'all');
  }

  function handleCopyTerminal() {
    if (!stoppedRecordingId) return;
    const rec = recordings.get(stoppedRecordingId);
    if (!rec) return;
    copyToClipboard(rec.lines.join('\n'), 'terminal');
  }

  function handleCopyBrowser() {
    if (!stoppedRecordingId) return;
    const rec = recordings.get(stoppedRecordingId);
    if (!rec) return;
    copyToClipboard(rec.browserLines.join('\n'), 'browser');
  }

  const stoppedRec = stoppedRecordingId ? recordings.get(stoppedRecordingId) : null;
  const hasBrowserStopped = stoppedRec ? stoppedRec.browserLines.length > 0 : false;

  // ── RECORDING: pulse + time → click opens live preview panel ──
  if (activeRecording) {
    const scriptNames = activeRecording.scripts.map(s => s.label || s.command).join(', ');
    const hasBrowser = activeRecording.browserPorts.length > 0;
    const displayLines = tab === 'browser' ? activeRecording.browserLines : activeRecording.rawLines;

    return (
      <Popover open={showLivePanel} onOpenChange={setShowLivePanel}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
            title="View live recording"
          >
            <span className="recording-pulse w-2 h-2 rounded-full bg-danger" />
            <span className="text-xs font-medium text-danger">{formatTime(elapsed)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="p-0 w-[420px] flex flex-col" style={{ maxHeight: '420px' }}>
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="recording-pulse w-2.5 h-2.5 rounded-full bg-danger flex-shrink-0" />
              <span className="text-sm font-medium truncate">{scriptNames}</span>
              <span className="text-xs text-text-muted flex-shrink-0">
                {formatTime(elapsed)} &middot; {activeRecording.lineCount} lines
              </span>
            </div>
          </div>

          {/* Tab toggle */}
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

          {/* Live output */}
          <div ref={scrollRef} className="overflow-y-auto flex-1 p-3 bg-[#0f1117]" style={{ minHeight: '120px' }}>
            <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
              {displayLines.join('\n') || (tab === 'browser' ? 'Waiting for browser logs... Refresh your app tab to start capture.' : '')}
            </pre>
          </div>

          {/* Stop button */}
          <div className="p-3 border-t border-border flex-shrink-0">
            <Button onClick={handleStop} variant="danger" className="w-full py-2 text-sm">
              Stop Recording
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // ── STOPPED: Copy Logs button with dropdown ──
  if (stoppedRecordingId && stoppedRec) {
    return (
      <div className="flex items-center gap-1">
        <Popover open={showCopyMenu} onOpenChange={setShowCopyMenu}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center gap-1 text-xs font-medium text-primary hover:bg-bg-hover px-1.5 py-0.5 rounded transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy Logs
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="p-1.5 min-w-[170px]">
            <button
              onClick={handleCopyAll}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors"
            >
              {copied === 'all' ? 'Copied!' : 'Copy All'}
            </button>
            <button
              onClick={handleCopyTerminal}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors"
            >
              {copied === 'terminal' ? 'Copied!' : 'Copy Terminal Logs'}
            </button>
            {hasBrowserStopped && (
              <button
                onClick={handleCopyBrowser}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors"
              >
                {copied === 'browser' ? 'Copied!' : 'Copy Browser Logs'}
              </button>
            )}
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => { setStoppedRecordingId(null); setShowCopyMenu(false); }}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors text-text-muted"
            >
              Dismiss
            </button>
          </PopoverContent>
        </Popover>
        <button
          onClick={() => { setStoppedRecordingId(null); setShowCopyMenu(false); }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text-muted hover:bg-bg-hover transition-all"
          aria-label="Dismiss"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // ── IDLE: Red rec button → ScriptPickerPanel popover ──
  return (
    <Popover open={showScriptPicker} onOpenChange={setShowScriptPicker}>
      <PopoverTrigger asChild>
        <button
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-danger hover:bg-bg-hover transition-all"
          aria-label="Record terminal"
          title="Record terminal"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="7" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="p-0 bg-transparent border-0 shadow-none w-80">
        <ScriptPickerPanel
          projectId={projectId}
          onClose={() => setShowScriptPicker(false)}
          onStarted={() => setShowScriptPicker(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
