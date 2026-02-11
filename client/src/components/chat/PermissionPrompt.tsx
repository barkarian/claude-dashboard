import { useState } from 'react';
import type { PendingPermission } from '../../hooks/useSDKMessages.ts';

interface PermissionPromptProps {
  permission: PendingPermission;
  onRespond: (requestId: string, granted: boolean) => void;
}

export default function PermissionPrompt({ permission, onRespond }: PermissionPromptProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mx-4 mb-3 rounded-xl border border-warning/40 bg-warning/5 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-5 h-5 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="text-sm font-medium text-text">Permission Required</span>
        </div>

        <p className="text-sm text-text-muted mb-1">
          <span className="font-mono text-xs bg-bg-surface px-1.5 py-0.5 rounded">{permission.toolName}</span>
        </p>
        {permission.description && (
          <p className="text-sm text-text mb-2">{permission.description}</p>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-text-muted hover:text-text transition-colors mb-3"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>

        {expanded && (
          <pre className="text-xs font-mono text-text-muted bg-bg-surface rounded-lg p-2 mb-3 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(permission.toolInput, null, 2)}
          </pre>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onRespond(permission.requestId, true)}
            className="flex-1 px-4 py-2 rounded-lg bg-success/20 text-success text-sm font-medium active:bg-success/40 transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => onRespond(permission.requestId, false)}
            className="flex-1 px-4 py-2 rounded-lg bg-danger/20 text-danger text-sm font-medium active:bg-danger/40 transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
