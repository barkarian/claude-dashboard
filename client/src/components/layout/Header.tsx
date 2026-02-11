import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  // Simple mode
  title?: string;
  backTo?: string;
  actions?: ReactNode;
  // Project mode
  projectName?: string;
  chatName?: string;
  chatId?: string;
  projectId?: string;
  onEditChatName?: (newName: string) => Promise<void>;
  onPowerOff?: () => void;
  showPowerOff?: boolean;
  statusDot?: string;
  statusLabel?: string;
  onNewChat?: () => void;
}

export default function Header({
  title,
  backTo,
  actions,
  projectName,
  chatName,
  chatId,
  projectId,
  onEditChatName,
  onPowerOff,
  showPowerOff,
  statusDot,
  statusLabel,
  onNewChat,
}: HeaderProps) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  function startEditing() {
    setEditValue(chatName || '');
    setEditing(true);
  }

  async function saveEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== chatName && onEditChatName) {
      await onEditChatName(trimmed);
    }
    setEditing(false);
  }

  function handleEditKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  // Simple mode: title only
  if (!projectName) {
    return (
      <header className="flex-shrink-0 bg-bg/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            {backTo && (
              <button
                onClick={() => navigate(backTo)}
                className="p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors"
              >
                <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            <h2 className="text-lg font-semibold truncate">{title}</h2>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>
    );
  }

  // Project mode: two rows
  return (
    <header className="flex-shrink-0 bg-bg/80 backdrop-blur-lg border-b border-border">
      {/* Row 1: Back to projects | Project Name | New Chat */}
      <div className="flex items-center justify-between h-12 px-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Projects
        </button>

        <h2 className="text-base font-semibold truncate mx-4">{projectName}</h2>

        {onNewChat ? (
          <button
            onClick={onNewChat}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
            aria-label="New chat"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        ) : (
          <div className="w-8" />
        )}
      </div>

      {/* Row 2: Chat name + edit | power-off | status (only when in a chat) */}
      {chatName && (
        <div className="flex items-center justify-between h-10 px-4 border-t border-border/50">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={() => saveEdit()}
                autoFocus
                className="flex-1 min-w-0 px-2 py-0.5 text-sm bg-bg-surface border border-primary rounded text-text focus:outline-none"
              />
            ) : (
              <>
                <span className="text-sm font-medium text-text truncate">{chatName}</span>
                {onEditChatName && (
                  <button
                    onClick={startEditing}
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-text-muted hover:bg-bg-hover transition-all"
                    aria-label="Rename chat"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {showPowerOff && onPowerOff && (
              <button
                onClick={onPowerOff}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-bg-surface active:bg-bg-hover hover:bg-bg-hover text-text-muted transition-colors"
                aria-label="End session"
                title="End session"
              >
                <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                </svg>
              </button>
            )}
            {statusDot && (
              <>
                <div className={`w-2 h-2 rounded-full ${statusDot}`} />
                <span className="text-xs text-text-muted capitalize">{statusLabel}</span>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
