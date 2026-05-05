import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSidebar } from '../ui/sidebar.tsx';
import TruncatedPath from '../ui/truncated-path.tsx';
import { haptics } from '../../utils/haptics.ts';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../ui/alert-dialog.tsx';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../ui/dialog.tsx';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../ui/dropdown-menu.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.tsx';
import type { ContextUsage } from '../../../../shared/types/session.ts';

interface HeaderProps {
  // Simple mode (page title)
  title?: string;
  backTo?: string;
  actions?: ReactNode;
  // Project mode
  projectName?: string;
  projectPath?: string;
  chatName?: string;
  chatDescription?: string | null;
  chatId?: string;
  projectId?: string;
  onEditChatName?: (newName: string) => Promise<void>;
  onGenerateTitle?: () => Promise<void>;
  generatingTitle?: boolean;
  onDeleteChat?: () => Promise<void>;
  contextUsage?: ContextUsage;
  statusDot?: string;
  statusLabel?: string;
  onNewChat?: () => void;
  onProjectSettings?: () => void;
  chatActions?: ReactNode;
  projectActions?: ReactNode;
  /** Workspace is in 'simple' mode — hide power-user surfaces (path breadcrumb, context %). */
  simpleMode?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatModel(model: string): string {
  return model
    .replace('claude-', '')
    .replace(/-\d{8}$/, '');
}

function ContextUsageBadge({ usage }: { usage: ContextUsage }) {
  const pct = usage.percentage;
  const windowLabel = usage.contextWindowMax >= 1_000_000
    ? `${(usage.contextWindowMax / 1_000_000).toFixed(0)}M`
    : `${(usage.contextWindowMax / 1_000).toFixed(0)}k`;

  // Color based on usage level
  const colorClass = pct > 80 ? 'text-danger' : pct > 50 ? 'text-warning' : 'text-text-dim';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono ${colorClass} hover:bg-bg-hover transition-all`}
          aria-label="Context window usage"
          title="Context window usage"
        >
          {pct.toFixed(1)}%
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text">Context Window</span>
            <span className="text-[10px] font-mono text-text-dim">{formatModel(usage.model)}</span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct > 80 ? 'bg-danger' : pct > 50 ? 'bg-warning' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-text-dim">
            <span>{formatTokens(usage.effectiveContext)}</span>
            <span>{windowLabel} window</span>
          </div>

          {/* Detailed breakdown */}
          <div className="border-t border-border pt-2 space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Input tokens</span>
              <span className="text-text font-mono">{formatTokens(usage.inputTokens)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Cache creation</span>
              <span className="text-text font-mono">{formatTokens(usage.cacheCreationTokens)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Cache read</span>
              <span className="text-text font-mono">{formatTokens(usage.cacheReadTokens)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Output tokens</span>
              <span className="text-text font-mono">{formatTokens(usage.outputTokens)}</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function Header({
  title,
  backTo,
  actions,
  projectName,
  projectPath,
  chatName,
  chatDescription,
  chatId,
  projectId,
  onEditChatName,
  onGenerateTitle,
  generatingTitle,
  onDeleteChat,
  contextUsage,
  statusDot,
  statusLabel,
  onNewChat,
  onProjectSettings,
  chatActions,
  projectActions,
  simpleMode,
}: HeaderProps) {
  const navigate = useNavigate();
  const { toggleSidebar: _toggleSidebar } = useSidebar();
  function toggleSidebar() {
    haptics.impactLight();
    _toggleSidebar();
  }
  const [editing, setEditing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
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
        <div className="flex items-center justify-between h-14 md:h-12 px-4">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSidebar}
              className="md:hidden p-2 -ml-1 rounded-lg hover:bg-bg-hover transition-colors"
              aria-label="Open menu"
            >
              <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
          <div className="flex items-center gap-2">
            {actions}
          </div>
        </div>
      </header>
    );
  }

  // Project mode: two rows
  return (
    <header className="flex-shrink-0 bg-bg/80 backdrop-blur-lg border-b border-border">
      {/* Row 1: Back to projects | Project Name | New Chat */}
      <div className="flex items-center justify-between h-16 md:h-14 px-4">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            onClick={toggleSidebar}
            className="md:hidden p-2 -ml-1 rounded-lg hover:bg-bg-hover transition-colors flex-shrink-0"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <button
            onClick={onProjectSettings}
            className="min-w-0 text-left hover:bg-bg-hover rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors cursor-pointer"
            style={{ maxWidth: '50vw' }}
            title="Workspace settings"
          >
            <h2 className="text-base font-semibold truncate leading-tight">{projectName}</h2>
            {projectPath && !simpleMode && <TruncatedPath path={projectPath} />}
          </button>
          {projectId && <WorkspaceSwitcher currentProjectId={projectId} />}
        </div>

        <div className="flex items-center gap-1">
          {projectActions}
          {onNewChat ? (
            <button
              onClick={onNewChat}
              className="flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-lg hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
              aria-label="New chat"
            >
              <svg className="w-6 h-6 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
        <div className="flex items-center justify-between h-12 md:h-10 px-4 border-t border-border/50">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {projectId && (
              <button
                onClick={() => navigate(`/project/${projectId}/chats`)}
                className="p-2 md:p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5 md:w-4 md:h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            {editing ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={() => saveEdit()}
                  autoFocus
                  className="flex-1 min-w-0 px-2 py-0.5 text-sm bg-bg-surface border border-primary rounded text-text focus:outline-none"
                />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={() => setEditing(false)}
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-bg-hover transition-all"
                  aria-label="Cancel editing"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <span className="text-sm font-medium text-text truncate">{chatName}</span>
                {chatDescription && (
                  <button
                    onClick={() => setShowInfo(true)}
                    className="flex-shrink-0 w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded text-text-dim hover:text-primary hover:bg-bg-hover transition-all"
                    aria-label="Chat summary"
                    title="View summary"
                  >
                    <svg className="w-5 h-5 md:w-[18px] md:h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                  </button>
                )}
                {contextUsage && !simpleMode && <ContextUsageBadge usage={contextUsage} />}
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
            {/* Combined actions menu (edit + delete) */}
            {(onEditChatName || onDeleteChat) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex-shrink-0 w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded text-text-dim hover:text-text-muted hover:bg-bg-hover transition-all"
                    aria-label="Chat actions"
                  >
                    <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onGenerateTitle && (
                    <DropdownMenuItem onClick={onGenerateTitle} disabled={generatingTitle}>
                      {generatingTitle ? (
                        <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                      )}
                      Auto generate title
                    </DropdownMenuItem>
                  )}
                  {onEditChatName && (
                    <DropdownMenuItem onClick={startEditing}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                      </svg>
                      Manual title
                    </DropdownMenuItem>
                  )}
                  {onDeleteChat && (
                    <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-danger focus:text-danger">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Delete chat
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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

      {/* Chat summary dialog */}
      <Dialog open={showInfo} onOpenChange={setShowInfo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{chatName}</DialogTitle>
            <DialogDescription>AI-generated summary</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-text leading-relaxed">
            {chatDescription}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
