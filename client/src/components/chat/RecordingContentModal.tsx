import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface RecordingContentModalProps {
  recordingId: string;
  onClose: () => void;
}

export default function RecordingContentModal({ recordingId, onClose }: RecordingContentModalProps) {
  const { recordings, activeRecording } = useTerminalRecording();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'terminal' | 'browser'>('terminal');
  const [copied, setCopied] = useState(false);

  const isLive = activeRecording?.id === recordingId;
  const rec = isLive ? activeRecording : recordings.get(recordingId);

  const hasBrowser = rec ? rec.browserLines.length > 0 || (isLive && 'browserPorts' in rec && (rec as any).browserPorts?.length > 0) : false;

  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isLive, rec?.rawLines.length, rec?.browserLines.length, tab]);

  if (!rec) return null;

  const scriptNames = rec.scripts.map(s => s.label || s.command).join(', ');
  const lineCount = rec.lines.length;
  const startTime = new Date(rec.startedAt).toLocaleTimeString();
  const stoppedAt = !isLive && 'stoppedAt' in rec && rec.stoppedAt
    ? new Date(rec.stoppedAt).toLocaleTimeString()
    : null;

  const displayLines = tab === 'browser' ? rec.browserLines : rec.rawLines;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayLines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[calc(100dvh-env(safe-area-inset-top,0px)-6rem)] sm:max-h-[80vh] flex flex-col p-0 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pr-12 border-b border-border flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isLive && <span className="recording-pulse w-2.5 h-2.5 rounded-full bg-danger" />}
              <span className="font-medium text-sm truncate">{scriptNames}</span>
            </div>
            <div className="text-xs text-text-muted mt-1">
              {lineCount} lines &middot; {startTime}
              {stoppedAt ? ` - ${stoppedAt}` : ' - now'}
            </div>
          </div>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        {hasBrowser && (
          <div className="flex border-b border-border flex-shrink-0">
            <button
              onClick={() => setTab('terminal')}
              className={`flex-1 text-xs py-2 text-center transition-colors ${tab === 'terminal' ? 'text-text font-medium border-b-2 border-primary' : 'text-text-muted hover:text-text'}`}
            >
              Terminal ({rec.rawLines.length})
            </button>
            <button
              onClick={() => setTab('browser')}
              className={`flex-1 text-xs py-2 text-center transition-colors ${tab === 'browser' ? 'text-text font-medium border-b-2 border-primary' : 'text-text-muted hover:text-text'}`}
            >
              Browser ({rec.browserLines.length})
            </button>
          </div>
        )}

        <div ref={scrollRef} className="overflow-y-auto flex-1 min-h-0 p-4 bg-[#0f1117]">
          <pre className="text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap break-all">
            {displayLines.join('\n') || (tab === 'browser' ? 'No browser logs captured.' : '')}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
