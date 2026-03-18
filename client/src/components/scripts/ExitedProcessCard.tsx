import { useState, useRef, useEffect } from 'react';
import api from '../../utils/api.ts';
import { stripAnsi } from '../../utils/ansi.ts';
import SendToChatDialog from './SendToChatDialog.tsx';
import type { RunningProcess } from '../../../../shared/types/models.ts';

interface ExitedProcessCardProps {
  process: RunningProcess;
  projectId: string;
  onDismiss: (scriptId: string) => void;
}

export default function ExitedProcessCard({ process, projectId, onDismiss }: ExitedProcessCardProps) {
  const [showPopover, setShowPopover] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendContent, setSendContent] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  const isSuccess = process.exitCode === 0;

  useEffect(() => {
    if (!showPopover) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPopover]);

  async function handleSendToChat() {
    try {
      const data = await api.get<{ buffer: string }>(`/api/projects/${projectId}/scripts/processes/${process.scriptId}/buffer`);
      setSendContent(stripAnsi(data.buffer));
      setShowPopover(false);
      setShowSendDialog(true);
    } catch (err) {
      console.error('Failed to fetch buffer:', err);
    }
  }

  const displayLabel = process.scriptId.startsWith('shell-') ? '> Terminal' : (process.label || process.command);
  const displayCommand = process.scriptId.startsWith('shell-') ? 'bash --login' : process.command;

  return (
    <div className="card hover:border-border-light transition-all">
      <div className="flex items-center gap-3">
        {/* Badge */}
        <div className="relative" ref={popoverRef}>
          <button
            onClick={() => setShowPopover(!showPopover)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
              isSuccess
                ? 'bg-success/20 text-success'
                : 'bg-danger/20 text-danger'
            }`}
          >
            {isSuccess ? 'Success' : 'Error'}
          </button>

          {showPopover && (
            <div className="absolute top-full left-0 mt-1 z-10 card shadow-lg p-2 min-w-[140px]">
              <button
                onClick={handleSendToChat}
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-bg-hover transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
                Send to Chat
              </button>
            </div>
          )}
        </div>

        {/* Label + command */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text truncate">{displayLabel}</div>
          <div className="text-xs text-text-dim font-mono truncate">{displayCommand}</div>
        </div>

        {/* Dismiss button */}
        <button
          onClick={() => onDismiss(process.scriptId)}
          className="p-2 rounded-lg hover:bg-bg-hover text-text-dim transition-colors flex-shrink-0"
          title="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showSendDialog && (
        <SendToChatDialog
          projectId={projectId}
          content={sendContent}
          contentLabel={process.label || process.command}
          onClose={() => setShowSendDialog(false)}
        />
      )}
    </div>
  );
}
