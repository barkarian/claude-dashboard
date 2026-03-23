import { useState, useEffect } from 'react';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface TerminalRecordButtonProps {
  onOpenScriptPicker: () => void;
  onOpenLivePreview: () => void;
  disabled?: boolean;
}

export default function TerminalRecordButton({ onOpenScriptPicker, onOpenLivePreview, disabled }: TerminalRecordButtonProps) {
  const { activeRecording } = useTerminalRecording();
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
      onOpenLivePreview();
    } else {
      onOpenScriptPicker();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-colors hover:bg-bg-hover disabled:opacity-50 flex-shrink-0"
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
  );
}
