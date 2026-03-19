import { useState, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface TerminalRecordButtonProps {
  onOpenScriptPicker: () => void;
  onOpenLivePreview: () => void;
  onStop?: (recordingId: string) => void;
  disabled?: boolean;
}

export default function TerminalRecordButton({ onOpenScriptPicker, onOpenLivePreview, onStop, disabled }: TerminalRecordButtonProps) {
  const { activeRecording, stopRecording } = useTerminalRecording();
  const [showPopover, setShowPopover] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!activeRecording) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeRecording.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRecording]);

  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function handleClick() {
    if (activeRecording) {
      setShowPopover(prev => !prev);
    } else {
      onOpenScriptPicker();
    }
  }

  function handleViewLive() {
    setShowPopover(false);
    onOpenLivePreview();
  }

  function handleStop() {
    setShowPopover(false);
    const id = stopRecording();
    if (id && onStop) onStop(id);
  }

  return (
    <div className="relative flex-shrink-0">
      <Popover open={showPopover} onOpenChange={setShowPopover}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-colors hover:bg-bg-hover disabled:opacity-50"
            aria-label={activeRecording ? 'Recording in progress' : 'Record terminal'}
          >
            {activeRecording ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-danger">
                <span className="recording-pulse w-3 h-3 rounded-full bg-danger" />
                {formatTime(elapsed)}
              </span>
            ) : (
              <svg className="w-5 h-5 text-danger" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="8" />
              </svg>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="p-2 min-w-[160px]">
          <button
            onClick={handleViewLive}
            className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors"
          >
            View Live
          </button>
          <button
            onClick={handleStop}
            className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors text-danger"
          >
            Stop Recording
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
