import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSidebar } from '../ui/sidebar.tsx';
import TruncatedPath from '../ui/truncated-path.tsx';
import { haptics } from '../../utils/haptics.ts';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../ui/alert-dialog.tsx';

interface HeaderProps {
  // Simple mode
  title?: string;
  backTo?: string;
  actions?: ReactNode;
  // Project mode
  projectName?: string;
  projectPath?: string;
  chatName?: string;
  chatId?: string;
  projectId?: string;
  onEditChatName?: (newName: string) => Promise<void>;
  onDeleteChat?: () => Promise<void>;
  statusDot?: string;
  statusLabel?: string;
  onNewChat?: () => void;
  onProjectSettings?: () => void;
  chatActions?: ReactNode;
  projectActions?: ReactNode;
}

export default function Header({
  title,
  backTo,
  actions,
  projectName,
  projectPath,
  chatName,
  chatId,
  projectId,
  onEditChatName,
  onDeleteChat,
  statusDot,
  statusLabel,
  onNewChat,
  onProjectSettings,
  chatActions,
  projectActions,
}: HeaderProps) {
  const navigate = useNavigate();
  const { toggleSidebar: _toggleSidebar } = useSidebar();
  function toggleSidebar() {
    haptics.impactLight();
    _toggleSidebar();
  }
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
        <div className="flex items-center justify-between h-12 px-4">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSidebar}
              className="md:hidden p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            {backTo && (
              <button
                onClick={() => window.history.length > 1 ? navigate(-1) : navigate(backTo)}
                className="p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors"
              >
                <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            <h2 className="text-sm font-semibold truncate">{title}</h2>
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
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            onClick={toggleSidebar}
            className="md:hidden p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors flex-shrink-0"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <button
            onClick={onProjectSettings}
            className="min-w-0 text-left hover:bg-bg-hover rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors cursor-pointer"
            style={{ maxWidth: '50vw' }}
            title="Project settings"
          >
            <h2 className="text-sm font-semibold truncate leading-tight">{projectName}</h2>
            {projectPath && <TruncatedPath path={projectPath} />}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {projectActions}
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
      </div>

      {/* Row 2: Chat name + edit | power-off | status (only when in a chat) */}
      {chatName && (
        <div className="flex items-center justify-between h-10 px-4 border-t border-border/50">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {projectId && (
              <button
                onClick={() => navigate(`/project/${projectId}/chats`)}
                className="p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
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
            {statusDot && (
              <>
                <div className={`w-2 h-2 rounded-full ${statusDot}`} />
                <span className="text-xs text-text-muted capitalize">{statusLabel}</span>
              </>
            )}
            {chatActions}
            {onDeleteChat && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-bg-hover transition-all"
                aria-label="Delete chat"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Delete chat confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{chatName}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowDeleteConfirm(false); onDeleteChat?.(); }}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
