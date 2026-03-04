import { useState, useEffect, useRef } from 'react';
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
  const popoverRef = useRef<HTMLDivElement>(null);

  // Update elapsed timer while recording
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

  // Close popover on outside click
  useEffect(() => {
    if (!showPopover) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPopover]);

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
    <div className="relative flex-shrink-0" ref={popoverRef}>
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

      {showPopover && (
        <div className="absolute bottom-full left-0 mb-2 card shadow-xl p-2 min-w-[160px] z-50">
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
        </div>
      )}
    </div>
  );
}
