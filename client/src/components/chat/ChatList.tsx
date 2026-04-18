import { useState, useEffect, useCallback, useRef, useMemo, type MouseEvent, type ReactNode } from 'react';
import { Card } from '../ui/card.tsx';
import { Button } from '../ui/button.tsx';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.ts';
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
import api from '../../utils/api.ts';
import { haptics } from '../../utils/haptics.ts';
import { toast } from 'sonner';
import PullToRefresh from '../ui/PullToRefresh.tsx';
import SwipeableRow from '../ui/SwipeableRow.tsx';
import type { SwipeAction } from '../ui/SwipeableRow.tsx';
import MobileSearchSheet from '../ui/MobileSearchSheet.tsx';
import { useIsMobile } from '../../hooks/use-mobile.tsx';
import { useGlobalActiveChats } from '../../hooks/useGlobalActiveChats.ts';
import type { Project, Chat } from '../../../../shared/types/models.ts';
import type { SessionStateContext } from '../../../../shared/types/session.ts';
import { getClientAdapter, listClientAdapters } from '../../adapters/registry.ts';
import { useAdapterSettings } from '../../hooks/useAdapterSettings.ts';
import NewChatPicker from './NewChatPicker.tsx';

const PAGE_SIZE = 20;

function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameYear) {
    return `${month}/${day} ${time}`;
  }
  return `${month}/${day}/${String(d.getFullYear()).slice(-2)} ${time}`;
}

/** Render a rich status badge from SessionStateContext */
function StatusBadge({ state }: { state: SessionStateContext }) {
  let text: string;
  let dotClass: string;

  switch (state.status) {
    case 'working':
      text = 'Thinking...';
      dotClass = 'bg-[#f97316] animate-pulse'; // orange
      break;
    case 'question-awaiting':
      text = state.questions?.[0]?.question?.slice(0, 30) || 'Question';
      dotClass = 'bg-[#a855f7]'; // purple
      break;
    case 'questions-awaiting':
      text = `${state.questions?.length || 0} questions`;
      dotClass = 'bg-[#a855f7]'; // purple
      break;
    case 'plan-awaiting':
      text = 'Plan ready';
      dotClass = 'bg-[#a855f7]'; // purple
      break;
    case 'permission-awaiting':
      text = `Needs: ${state.pendingTool?.toolName || 'Approval'}`;
      dotClass = 'bg-[#a855f7]'; // purple
      break;
    case 'starting':
      text = 'Starting...';
      dotClass = 'bg-text-dim';
      break;
    case 'idle':
      text = 'Active';
      dotClass = 'bg-success';
      break;
    default:
      return null;
  }

  return (
    <>
      <span className="text-border">&middot;</span>
      <span className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {text}
      </span>
    </>
  );
}

interface ChatListProps {
  projectId: string;
  project: Project;
  sessionStates?: Record<string, SessionStateContext>;
}

interface SortableChatCardProps {
  chat: Chat;
  children: ReactNode;
  onClick: () => void;
}

function SortableChatCard({ chat, children, onClick }: SortableChatCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chat.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        className="text-left w-full hover-hover:border-border-light transition-all group cursor-pointer"
        onClick={onClick}
      >
        {children}
      </Card>
    </div>
  );
}

export default function ChatList({ projectId, project, sessionStates = {} }: ChatListProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { socket } = useSocket();
  const { refreshProject, setProject } = useProject();
  const isMobile = useIsMobile();
  const activeChats = useGlobalActiveChats();
  const activeChatMatch = location.pathname.match(/\/chats\/([^/]+)/);
  const activeChatId = activeChatMatch ? activeChatMatch[1] : null;
  const [creating, setCreating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { enabledIds, adapters: adapterInfos } = useAdapterSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);
  const [renameTarget, setRenameTarget] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editMenuTarget, setEditMenuTarget] = useState<Chat | null>(null);
  const [generatingTitle, setGeneratingTitle] = useState<string | null>(null);
  const [infoChat, setInfoChat] = useState<Chat | null>(null);

  // Track which chats have unread completions
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const chat of project?.chats || []) {
      if (chat.unread) ids.add(chat.id);
    }
    return ids;
  });

  // Listen for real-time unread events (skip if user is already viewing that chat)
  useEffect(() => {
    if (!socket) return;
    function handleUnread({ chatId }: { chatId: string }) {
      if (chatId === activeChatId) return;
      setUnreadIds(prev => new Set(prev).add(chatId));
    }
    socket.on('chat:unread', handleUnread);
    return () => { socket.off('chat:unread', handleUnread); };
  }, [socket, activeChatId]);

  // Navigate to a chat and mark it as read
  const goToChat = useCallback((chatId: string, state?: object) => {
    if (unreadIds.has(chatId)) {
      setUnreadIds(prev => { const next = new Set(prev); next.delete(chatId); return next; });
      api.put(`/api/projects/${projectId}/chats/${chatId}/read`).catch(() => {});
    }
    navigate(`/project/${projectId}/chats/${chatId}`, state ? { state } : undefined);
  }, [projectId, navigate, unreadIds]);

  // Paginated state
  const [chats, setChats] = useState<Chat[]>([]);
  const [total, setTotal] = useState(0);
  const offsetRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch chats (initial or on search change)
  useEffect(() => {
    loadChats(true);
  }, [projectId, debouncedSearch]);

  async function loadChats(reset: boolean) {
    const currentOffset = reset ? 0 : offsetRef.current;
    if (!reset) setLoadingMore(true);
    if (reset) {
      setInitialLoading(true);
      setHasMore(false);
    }

    try {
      const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '';
      const data = await api.get<{ chats: Chat[]; total: number }>(
        `/api/projects/${projectId}/chats?limit=${PAGE_SIZE}&offset=${currentOffset}${searchParam}`
      );
      const newChats = data.chats || [];
      if (reset) {
        setChats(newChats);
      } else {
        setChats(prev => [...prev, ...newChats]);
      }
      // Sync unread state from freshly loaded chats
      const freshUnread = newChats.filter(c => c.unread).map(c => c.id);
      if (freshUnread.length > 0) {
        setUnreadIds(prev => {
          const next = reset ? new Set<string>() : new Set(prev);
          for (const id of freshUnread) next.add(id);
          return next;
        });
      } else if (reset) {
        setUnreadIds(new Set());
      }
      const newOffset = currentOffset + newChats.length;
      setTotal(data.total || 0);
      offsetRef.current = newOffset;
      setHasMore(newOffset < (data.total || 0));
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
      setInitialLoading(false);
    }
  }

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadChats(false);
    }
  }, [loadingMore, hasMore, projectId, debouncedSearch]);

  const { sentinelRef } = useInfiniteScroll({ loadMore, hasMore, loading: loadingMore });

  async function createChatWithAdapter(adapterId: string) {
    setCreating(true);
    try {
      const data = await api.post<{ chat: Chat }>(`/api/projects/${projectId}/chats`, { label: 'New Chat', adapter: adapterId });
      const created = data.chat;
      setProject(prev => {
        if (!prev || prev.id !== projectId) return prev;
        const rest = prev.chats.filter(c => c.id !== created.id);
        return { ...prev, chats: [created, ...rest] };
      });
      navigate(`/project/${projectId}/chats/${created.id}`, {
        state: { isNewChat: true, adapter: created.adapter },
      });
    } catch (err) {
      console.error('Failed to create chat:', err);
    } finally {
      setCreating(false);
    }
  }

  function handleNewChat() {
    if (enabledIds.length === 0) {
      // No adapters enabled → navigate to settings
      navigate('/settings#chat-agents');
      return;
    }
    if (enabledIds.length === 1) {
      // Only one adapter → use it directly
      createChatWithAdapter(enabledIds[0]);
      return;
    }
    // Check if project has a default adapter that is enabled
    const defaultAdapter = project?.defaultAdapter;
    if (defaultAdapter && enabledIds.includes(defaultAdapter)) {
      createChatWithAdapter(defaultAdapter);
      return;
    }
    // Multiple enabled, no valid default → show picker
    setPickerOpen(true);
  }

  function handlePickerSelect(adapterId: string) {
    setPickerOpen(false);
    createChatWithAdapter(adapterId);
  }

  function handleAdapterReorder(nextOrder: string[]) {
    // Optimistic local update so the drawer reflects the new order immediately.
    setProject(prev => {
      if (!prev || prev.id !== projectId) return prev;
      return { ...prev, adapterOrder: nextOrder, defaultAdapter: nextOrder[0] || prev.defaultAdapter };
    });
    api.patch(`/api/projects/${projectId}`, { adapterOrder: nextOrder }).catch(() => {
      // On failure, refresh to re-sync.
      refreshProject();
    });
  }

  function handleForcePickerOpen() {
    if (enabledIds.length === 0) {
      navigate('/settings#chat-agents');
      return;
    }
    setPickerOpen(true);
  }

  function promptDelete(chat: Chat, e: MouseEvent) {
    e.stopPropagation();
    haptics.notificationWarning();
    setDeleteTarget(chat);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    haptics.notificationError();
    try {
      if (socket) {
        // Stop session via unified adapter event, with legacy fallback
        socket.emit('chat:stop', { chatId: deleteTarget.id });
        if (deleteTarget.adapter === 'claude-code') {
          socket.emit('cc:stop', { chatId: deleteTarget.id });
        } else if (sessionStates[deleteTarget.id]) {
          socket.emit('sdk:end', { chatId: deleteTarget.id });
        }
      }
      await api.delete(`/api/projects/${projectId}/chats/${deleteTarget.id}`);
      setChats(prev => prev.filter(c => c.id !== deleteTarget.id));
      setTotal(prev => prev - 1);
      refreshProject();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
    setDeleteTarget(null);
  }

  async function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await api.patch(`/api/projects/${projectId}/chats/${renameTarget.id}`, { label: renameValue.trim() });
      setChats(prev => prev.map(c => c.id === renameTarget.id ? { ...c, label: renameValue.trim() } : c));
      refreshProject();
    } catch (err) {
      console.error('Failed to rename chat:', err);
    }
    setRenameTarget(null);
  }

  async function handleGenerateTitle(chat: Chat) {
    setGeneratingTitle(chat.id);
    toast.loading('Generating title & summary...', { id: `gen-title-${chat.id}` });
    try {
      const result = await api.post<{ title: string; description: string }>(
        `/api/projects/${projectId}/chats/${chat.id}/generate-title`
      );
      setChats(prev => prev.map(c =>
        c.id === chat.id ? { ...c, label: result.title, description: result.description || null } : c
      ));
      refreshProject();
      toast.success('Title & summary generated', { id: `gen-title-${chat.id}` });
    } catch (err) {
      console.error('Failed to generate title:', err);
      toast.error('Failed to generate title', { id: `gen-title-${chat.id}` });
    } finally {
      setGeneratingTitle(null);
    }
  }

  function handleSetUnread(chat: Chat) {
    setUnreadIds(prev => new Set(prev).add(chat.id));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/unread`).catch(() => {});
  }

  function handleDismiss(chat: Chat) {
    api.put(`/api/projects/${projectId}/chats/${chat.id}/dismiss`).catch(() => {});
  }

  function handleToggleFavorite(chat: Chat) {
    const next = !chat.favorite;
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, favorite: next } : c));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/favorite`, { favorite: next }).catch(() => {
      // Revert on error
      setChats(prev => prev.map(c => c.id === chat.id ? { ...c, favorite: !next } : c));
    });
  }

  const [isChatDragActive, setIsChatDragActive] = useState(false);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleChatDragEnd(e: DragEndEvent) {
    setIsChatDragActive(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = chats.map(c => c.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = [...chats];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setChats(reordered);
    const prevId = newIndex > 0 ? reordered[newIndex - 1].id : null;
    const nextId = newIndex < reordered.length - 1 ? reordered[newIndex + 1].id : null;
    api.put(`/api/projects/${projectId}/chats/${moved.id}/order`, { prevId, nextId }).catch(() => {
      // Refetch on error to restore truth.
      loadChats(true);
    });
  }

  // Build swipe actions for mobile chat rows (long-press is reserved for drag-to-reorder).
  function buildSwipeActions(chat: Chat, _isSeen: boolean): SwipeAction[] {
    const actions: SwipeAction[] = [];
    actions.push({
      icon: chat.favorite ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.32.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.32-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
      ) : (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.967a1 1 0 00.95.69h4.175c.969 0 1.371 1.24.588 1.81l-3.378 2.455a1 1 0 00-.364 1.118l1.287 3.966c.3.922-.755 1.688-1.54 1.118l-3.378-2.454a1 1 0 00-1.175 0l-3.378 2.454c-.784.57-1.838-.196-1.539-1.118l1.287-3.966a1 1 0 00-.364-1.118L2.05 9.394c-.783-.57-.38-1.81.588-1.81h4.175a1 1 0 00.95-.69l1.286-3.967z" /></svg>
      ),
      label: chat.favorite ? 'Unstar' : 'Star',
      className: 'bg-warning',
      onAction: () => handleToggleFavorite(chat),
    });
    if (!unreadIds.has(chat.id)) {
      actions.push({
        icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>,
        label: 'Unread',
        className: 'bg-primary',
        onAction: () => handleSetUnread(chat),
      });
    }
    actions.push({
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
      label: 'Dismiss',
      className: 'bg-text-dim',
      onAction: () => handleDismiss(chat),
    });
    actions.push({
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>,
      label: 'Edit',
      className: 'bg-[#6b7280]',
      onAction: () => setEditMenuTarget(chat),
    });
    actions.push({
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
      label: 'Delete',
      className: 'bg-danger',
      onAction: () => { haptics.notificationWarning(); setDeleteTarget(chat); },
    });
    return actions;
  }

  // Determine which chats are in 'seen' state (read but not dismissed from tracker)
  const seenChatIds = useMemo(() => {
    const ids = new Set<string>();
    const projectData = activeChats.byProject[projectId];
    if (projectData) {
      for (const c of projectData.chats) {
        if (c.status === 'seen') ids.add(c.chatId);
      }
    }
    return ids;
  }, [activeChats, projectId]);

  const showSearch = chats.length > 0 || searchQuery;

  return (
    <PullToRefresh onRefresh={() => loadChats(true)} className="p-4 space-y-3" disabled={isChatDragActive}>
      <div className="flex gap-1">
        <Button onClick={handleNewChat} disabled={creating} variant="outline" className="flex-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {creating ? 'Creating...' : 'New Chat'}
        </Button>
        {enabledIds.length > 1 && (
          <Button onClick={handleForcePickerOpen} disabled={creating} variant="outline" size="sm" className="px-2">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </Button>
        )}
      </div>

      {/* Adapter picker sheet */}
      <NewChatPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        enabledAdapters={adapterInfos.filter(a => a.enabled).map(a => ({ metadata: a.metadata }))}
        adapterOrder={project?.adapterOrder ?? null}
        onReorder={handleAdapterReorder}
      />

      {/* Search input */}
      {showSearch && (
        <div className="relative">
          <svg className="w-4 h-4 text-text-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={(e) => {
              if (isMobile) {
                e.target.blur();
                setSheetOpen(true);
              }
            }}
            placeholder="Search chats..."
            readOnly={isMobile}
            className="w-full pl-9 pr-8 py-2 text-sm bg-bg-surface border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-primary transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Mobile search sheet */}
      <MobileSearchSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open && !searchQuery) setSearchQuery('');
        }}
        title="Search Chats"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search chats..."
        loading={initialLoading}
        emptyContent={
          chats.length === 0 && searchQuery
            ? <div className="py-4 text-sm text-text-muted text-center">No matching chats</div>
            : chats.length === 0
              ? <div className="py-4 text-sm text-text-muted text-center">No chats yet</div>
              : undefined
        }
      >
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => {
              setSheetOpen(false);
              goToChat(chat.id);
            }}
            className="w-full text-left px-3 py-2.5 rounded-lg active:bg-bg-hover transition-colors flex items-center gap-2"
          >
            <div className="relative flex-shrink-0">
              <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              {unreadIds.has(chat.id) && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-text truncate">{chat.label || 'Untitled Chat'}</span>
                {(() => {
                  const adapterMeta = getClientAdapter(chat.adapter)?.metadata;
                  return adapterMeta?.shortLabel ? (
                    <span className={`flex-shrink-0 text-[10px] font-medium px-1 py-0.5 rounded ${adapterMeta.badgeColor || 'bg-primary/10 text-primary'}`}>{adapterMeta.shortLabel}</span>
                  ) : null;
                })()}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted">
                <span>{formatChatTime(chat.lastActivityAt || chat.createdAt)}</span>
                {sessionStates[chat.id]
                  ? <StatusBadge state={sessionStates[chat.id]} />
                  : null}
                {chat.draftMessage && (
                  <>
                    <span className="text-border">&middot;</span>
                    <span className="text-warning italic">Draft</span>
                  </>
                )}
              </div>
            </div>
            <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        ))}
      </MobileSearchSheet>

      {initialLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : chats.length === 0 && !searchQuery ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          {enabledIds.length === 0 ? (
            <>
              <h3 className="text-text font-medium mb-1">Set up a chat agent</h3>
              <p className="text-text-muted text-sm mb-4">Configure an AI agent to start coding</p>
              <div className="space-y-2 max-w-xs mx-auto">
                {adapterInfos.map(a => (
                  <button
                    key={a.metadata.id}
                    onClick={() => navigate('/settings#chat-agents')}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-bg-hover/50 transition-colors text-left"
                  >
                    <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded ${a.metadata.badgeColor}`}>
                      {a.metadata.shortLabel}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text">{a.metadata.displayName}</div>
                      <div className="text-xs text-text-muted truncate">{a.metadata.description}</div>
                    </div>
                    <span className="text-xs text-primary font-medium flex-shrink-0">Set Up</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3 className="text-text font-medium mb-1">No chats yet</h3>
              <p className="text-text-muted text-sm mb-4">Click New Chat to start a conversation</p>
            </>
          )}
        </div>
      ) : chats.length === 0 && searchQuery ? (
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No matching chats</p>
        </div>
      ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={() => setIsChatDragActive(true)}
          onDragCancel={() => setIsChatDragActive(false)}
          onDragEnd={handleChatDragEnd}
        >
        <SortableContext items={chats.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <>
          {chats.map((chat) => {
            const isSeen = seenChatIds.has(chat.id);
            return (
            <SwipeableRow
              key={chat.id}
              {...(isMobile
                ? { actions: buildSwipeActions(chat, isSeen) }
                : {
                    onDelete: isSeen ? undefined : () => setDeleteTarget(chat),
                    onDismiss: isSeen ? () => handleDismiss(chat) : undefined,
                  }
              )}
            >
            <SortableChatCard
              chat={chat}
              onClick={() => goToChat(chat.id)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {chat.favorite ? (
                      <svg className="flex-shrink-0 w-3 h-3 text-warning" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.967a1 1 0 00.95.69h4.175c.969 0 1.371 1.24.588 1.81l-3.378 2.455a1 1 0 00-.364 1.118l1.287 3.966c.3.922-.755 1.688-1.54 1.118l-3.378-2.454a1 1 0 00-1.175 0l-3.378 2.454c-.784.57-1.838-.196-1.539-1.118l1.287-3.966a1 1 0 00-.364-1.118L2.05 9.394c-.783-.57-.38-1.81.588-1.81h4.175a1 1 0 00.95-.69l1.286-3.967z" />
                      </svg>
                    ) : unreadIds.has(chat.id) ? (
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-primary" />
                    ) : isSeen ? (
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-border" />
                    ) : null}
                    <h4 className={`font-medium group-hover-hover:text-primary transition-colors truncate ${unreadIds.has(chat.id) ? 'text-text font-semibold' : 'text-text'}`}>
                      {generatingTitle === chat.id ? (
                        <span className="flex items-center gap-1.5">
                          <span className="animate-spin w-3 h-3 border-2 border-primary border-t-transparent rounded-full flex-shrink-0" />
                          <span className="text-text-muted italic">Generating...</span>
                        </span>
                      ) : chat.label}
                    </h4>
                    {(() => {
                      const adapterMeta = getClientAdapter(chat.adapter)?.metadata;
                      return adapterMeta?.shortLabel ? (
                        <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${adapterMeta.badgeColor || 'bg-primary/10 text-primary'}`}>
                          {adapterMeta.shortLabel}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                    <span>{formatChatTime(chat.lastActivityAt || chat.createdAt)}</span>
                    {sessionStates[chat.id]
                      ? <StatusBadge state={sessionStates[chat.id]} />
                      : null}
                    {chat.draftMessage && (
                      <>
                        <span className="text-border">&middot;</span>
                        <span className="text-warning italic">Draft</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Favorite toggle — desktop only */}
                  {!isMobile && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleFavorite(chat); }}
                      className={`w-7 h-7 flex items-center justify-center rounded hover-hover:bg-bg-hover transition-all ${chat.favorite ? 'text-warning' : 'text-text-dim hover-hover:text-warning'}`}
                      aria-label={chat.favorite ? 'Unfavorite' : 'Set as favorite'}
                      title={chat.favorite ? 'Unfavorite' : 'Set as favorite'}
                    >
                      {chat.favorite ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.967a1 1 0 00.95.69h4.175c.969 0 1.371 1.24.588 1.81l-3.378 2.455a1 1 0 00-.364 1.118l1.287 3.966c.3.922-.755 1.688-1.54 1.118l-3.378-2.454a1 1 0 00-1.175 0l-3.378 2.454c-.784.57-1.838-.196-1.539-1.118l1.287-3.966a1 1 0 00-.364-1.118L2.05 9.394c-.783-.57-.38-1.81.588-1.81h4.175a1 1 0 00.95-.69l1.286-3.967z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.32.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.32-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                        </svg>
                      )}
                    </button>
                  )}
                  {/* Mark as unread — desktop only */}
                  {!isMobile && !unreadIds.has(chat.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetUnread(chat); }}
                      className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover-hover:text-primary hover-hover:bg-bg-hover transition-all"
                      aria-label="Mark as unread"
                      title="Mark as unread"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </button>
                  )}
                  {/* Dismiss button — desktop only */}
                  {!isMobile && isSeen && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismiss(chat);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover-hover:text-text hover-hover:bg-bg-hover transition-all"
                      aria-label="Dismiss from tracker"
                      title="Dismiss from sidebar"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  {/* Info icon — bigger on mobile */}
                  {chat.description && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInfoChat(chat); }}
                      className={`flex items-center justify-center rounded text-text-dim hover-hover:text-primary hover-hover:bg-bg-hover transition-all ${isMobile ? 'w-8 h-8' : 'w-7 h-7'}`}
                      aria-label="Chat summary"
                      title="View summary"
                    >
                      <svg className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                    </button>
                  )}
                  {/* Edit dropdown + delete button — desktop only */}
                  {!isMobile && (
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover-hover:text-text-muted hover-hover:bg-bg-hover transition-all"
                            aria-label="Edit chat"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleGenerateTitle(chat); }}>
                            {generatingTitle === chat.id ? (
                              <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                              </svg>
                            )}
                            Auto generate title
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenameTarget(chat); setRenameValue(chat.label); }}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                            </svg>
                            Manual title
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button
                        onClick={(e) => promptDelete(chat, e)}
                        className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover-hover:text-danger hover-hover:bg-bg-hover transition-all"
                        aria-label="Delete chat"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </>
                  )}
                  <svg className="w-5 h-5 text-text-dim group-hover-hover:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            </SortableChatCard>
            </SwipeableRow>
            );
          })}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} />
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </>
        </SortableContext>
        </DndContext>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.label}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-danger hover:bg-danger/90 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename dialog */}
      <AlertDialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename chat</AlertDialogTitle>
            <AlertDialogDescription>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="w-full mt-2 px-3 py-2 bg-bg border border-border rounded-lg text-text text-sm focus:outline-none focus:border-primary"
                autoFocus
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename}>Rename</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mobile edit menu (swipe Edit action) */}
      <AlertDialog open={!!editMenuTarget} onOpenChange={(open) => !open && setEditMenuTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit title</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={() => {
                    const chat = editMenuTarget!;
                    setEditMenuTarget(null);
                    handleGenerateTitle(chat);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-3 rounded-lg bg-bg hover:bg-bg-hover text-text text-sm transition-colors"
                >
                  {editMenuTarget && generatingTitle === editMenuTarget.id ? (
                    <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                  ) : (
                    <svg className="w-5 h-5 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  )}
                  Auto generate title
                </button>
                <button
                  onClick={() => {
                    const chat = editMenuTarget!;
                    setEditMenuTarget(null);
                    setRenameTarget(chat);
                    setRenameValue(chat.label);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-3 rounded-lg bg-bg hover:bg-bg-hover text-text text-sm transition-colors"
                >
                  <svg className="w-5 h-5 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                  </svg>
                  Manual title
                </button>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Chat summary dialog */}
      <Dialog open={!!infoChat} onOpenChange={(open) => !open && setInfoChat(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{infoChat?.label}</DialogTitle>
            <DialogDescription>AI-generated summary</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-text leading-relaxed">
            {infoChat?.description}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-dim mt-2">
            <span>{getClientAdapter(infoChat?.adapter || '')?.metadata.displayName || infoChat?.adapter || 'Unknown'}</span>
            <span className="text-border">&middot;</span>
            <span>{infoChat && formatChatTime(infoChat.lastActivityAt || infoChat.createdAt)}</span>
          </div>
        </DialogContent>
      </Dialog>

    </PullToRefresh>
  );
}
