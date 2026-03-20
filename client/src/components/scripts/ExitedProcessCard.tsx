import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api.ts';
import { stripAnsi } from '../../utils/ansi.ts';
import { Card } from '../ui/card.tsx';
import { Badge } from '../ui/badge.tsx';
import SendToChatDialog from './SendToChatDialog.tsx';
import type { RunningProcess } from '../../../../shared/types/models.ts';

interface ExitedProcessCardProps {
  process: RunningProcess;
  projectId: string;
  onDismiss: (scriptId: string) => void;
}

export default function ExitedProcessCard({ process, projectId, onDismiss }: ExitedProcessCardProps) {
  const navigate = useNavigate();
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendContent, setSendContent] = useState('');

  const isSuccess = process.exitCode === 0;

  async function handleSendToChat() {
    try {
      const data = await api.get<{ buffer: string }>(`/api/projects/${projectId}/scripts/processes/${process.scriptId}/buffer`);
      setSendContent(stripAnsi(data.buffer));
      setShowSendDialog(true);
    } catch (err) {
      console.error('Failed to fetch buffer:', err);
    }
  }

  const displayLabel = process.scriptId.startsWith('shell-') ? '> Terminal' : (process.label || process.command);
  const displayCommand = process.scriptId.startsWith('shell-') ? 'bash --login' : process.command;

  return (
    <Card className="hover:border-border-light transition-all group cursor-pointer" onClick={() => navigate(`/project/${projectId}/scripts/${process.scriptId}`)}>
      <div className="flex items-center gap-3">
        {/* Badge */}
        <Badge variant={isSuccess ? 'success' : 'danger'} className="flex-shrink-0">
          {isSuccess ? 'Success' : 'Error'}
        </Badge>

        {/* Label + command */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text group-hover:text-primary transition-colors truncate">{displayLabel}</div>
          <div className="text-xs text-text-dim font-mono truncate">{displayCommand}</div>
        </div>

        {/* Send to Chat */}
        <button
          onClick={(e) => { e.stopPropagation(); handleSendToChat(); }}
          className="p-2 rounded-lg hover:bg-bg-hover text-text-dim transition-colors flex-shrink-0"
          title="Send to Chat"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </button>

        {/* Dismiss button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(process.scriptId); }}
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
    </Card>
  );
}
