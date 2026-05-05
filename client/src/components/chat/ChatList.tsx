import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type MouseEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { Card } from '../ui/card.tsx';
import { Button } from '../ui/button.tsx';
import { useNavigate, useLocation } from 'react-router-dom';
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
import ContextMenu from '../ui/ContextMenu.tsx';
import MobileSearchSheet from '../ui/MobileSearchSheet.tsx';
import { useIsMobile } from '../../hooks/use-mobile.tsx';
import { useGlobalActiveChats } from '../../hooks/useGlobalActiveChats.ts';
import { useSidebarSync } from '../../hooks/useSidebarSync.ts';
import type { Project, Chat, ChatCategory } from '../../../../shared/types/models.ts';
import type { SessionStateContext } from '../../../../shared/types/session.ts';
import { getClientAdapter, listClientAdapters } from '../../adapters/registry.ts';
import { useAdapterSettings } from '../../hooks/useAdapterSettings.ts';
import NewChatPicker from './NewChatPicker.tsx';
import CategoryManager from './CategoryManager.tsx';

const PAGE_SIZE = 20;

type BucketKey = string; // 'today' | 'yesterday' | 'weekday-N' | 'earlier-this-month' | 'month-YYYY-MM'

interface ChatBucket {
  key: BucketKey;
  label: string;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Compute the time-bucket a chat falls into relative to `now`. Buckets are
// rendered as section headers in the chat list. Returning a stable `key` lets
// us group by bucket without re-deriving labels per row.
function getChatBucket(date: Date, now: Date): ChatBucket {
  const dayMs = 86_400_000;
  const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / dayMs);

  if (diffDays <= 0) return { key: 'today', label: 'Today' };
  if (diffDays === 1) return { key: 'yesterday', label: 'Yesterday' };
  // Days 2–6: weekday name. Cap at 6 so we never collide with today's weekday.
  if (diffDays <= 6) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
    return { key: `weekday-${diffDays}`, label: weekday };
  }
  // Older than a week but still in the current calendar month.
  const sameMonth = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (sameMonth) return { key: 'earlier-this-month', label: 'Earlier this month' };
  // Month buckets: name only when in same year, "Month YYYY" otherwise.
  const sameYear = date.getFullYear() === now.getFullYear();
  const monthName = date.toLocaleDateString(undefined, { month: 'long' });
  const key = `month-${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
  return { key, label: sameYear ? monthName : `${monthName} ${date.getFullYear()}` };
}

// Format the per-row metadata. Inside same-day buckets we drop the date since
// the section header already provides it; older buckets show a short date.
// When `bucketKey` is omitted (e.g., search sheet, summary dialog) falls back
// to a self-contained date+time.
function formatChatTime(dateStr: string, bucketKey?: BucketKey): string {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (bucketKey === 'today' || bucketKey === 'yesterday' || bucketKey?.startsWith('weekday-')) {
    return time;
  }
  const now = new Date();
  const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const datePart = d.getFullYear() !== now.getFullYear() ? `${monthDay}, ${d.getFullYear()}` : monthDay;
  // Outside the grouped list, include the time so the value remains readable on its own.
  return bucketKey ? datePart : `${datePart} ${time}`;
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

interface ChatCardProps {
  children: ReactNode;
  onClick: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
  onLongPressStart?: (e: ReactTouchEvent) => void;
  onLongPressMove?: (e: ReactTouchEvent) => void;
  onLongPressEnd?: () => void;
}

function ChatCard({
  children, onClick, onMouseEnter, onMouseLeave,
  onLongPressStart, onLongPressMove, onLongPressEnd,
}: ChatCardProps) {
  // `user-select / -webkit-touch-callout: none` keep iOS from stealing the
  // long-press for its native text-selection popover.
  const style = {
    WebkitUserSelect: 'none' as const,
    userSelect: 'none' as const,
    WebkitTouchCallout: 'none' as const,
    touchAction: 'manipulation' as const,
  };
  return (
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Card
        className="text-left w-full hover-hover:border-border-light transition-all group cursor-pointer"
        onClick={onClick}
        onTouchStart={onLongPressStart}
        onTouchMove={onLongPressMove}
        onTouchEnd={onLongPressEnd}
        onTouchCancel={onLongPressEnd}
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
  const { enabledIds, adapters: adapterInfos, loading: adaptersLoading } = useAdapterSettings();
  // Mode-eligible enabled adapters: simple mode hides terminal-only adapters
  // (claude-code) since they require the dev surface. Use this — not raw
  // enabledIds — when deciding picker behavior so the simple-mode chooser
  // surfaces every non-terminal adapter the user has set up in the catalog.
  const eligibleEnabledIds = useMemo(() => {
    const isSimple = project?.mode === 'simple';
    return adapterInfos
      .filter(a => a.enabled)
      .filter(a => !isSimple || !a.metadata.capabilities.terminal)
      .map(a => a.metadata.id);
  }, [adapterInfos, project?.mode]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);
  const [renameTarget, setRenameTarget] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [generatingTitle, setGeneratingTitle] = useState<string | null>(null);
  const [infoChat, setInfoChat] = useState<Chat | null>(null);
  const [hoverCtx, setHoverCtx] = useState<{ chat: Chat; x: number; y: number } | null>(null);
  const hoverShowRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);

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

  // Categories — fetched on mount and refreshed when the manager mutates them.
  const [categories, setCategories] = useState<ChatCategory[]>([]);
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>([]);
  const [managerOpen, setManagerOpen] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Live sync from server (mirrors the sidebar's useSidebarSync) ────
  // Keeps the chat list view in lockstep with sidebar mutations from other
  // devices/tabs: new chats from another client appear here, category emoji
  // changes flip live, deleted chats disappear without a refetch.
  const onSyncChatCreated = useCallback((e: { projectId: string; chat: Chat }) => {
    if (e.projectId !== projectId) return;
    setChats(prev => prev.some(c => c.id === e.chat.id) ? prev : [e.chat, ...prev]);
    setTotal(t => t + 1);
  }, [projectId]);

  const onSyncChatDeleted = useCallback((e: { projectId: string; chatId: string }) => {
    if (e.projectId !== projectId) return;
    setChats(prev => {
      const filtered = prev.filter(c => c.id !== e.chatId);
      if (filtered.length === prev.length) return prev;
      setTotal(t => Math.max(0, t - 1));
      return filtered;
    });
  }, [projectId]);

  const onSyncChatMetaChanged = useCallback((e: {
    projectId: string;
    chatId: string;
    label?: string;
    categoryId?: string | null;
    categoryEmoji?: string | null;
    lastActivityAt?: string;
  }) => {
    if (e.projectId !== projectId) return;
    setChats(prev => {
      let changed = false;
      const next = prev.map(c => {
        if (c.id !== e.chatId) return c;
        changed = true;
        const updated: Chat = { ...c };
        if (e.label !== undefined) updated.label = e.label;
        if (e.categoryId !== undefined) updated.categoryId = e.categoryId;
        if (e.categoryEmoji !== undefined) {
          if (e.categoryEmoji === null) {
            updated.category = null;
          } else if (updated.category) {
            updated.category = { ...updated.category, emoji: e.categoryEmoji };
          }
        }
        if (e.lastActivityAt !== undefined) updated.lastActivityAt = e.lastActivityAt;
        return updated;
      });
      return changed ? next : prev;
    });
  }, [projectId]);

  useSidebarSync({
    onChatCreated: onSyncChatCreated,
    onChatDeleted: onSyncChatDeleted,
    onChatMetaChanged: onSyncChatMetaChanged,
  });

  // Fetch chats (initial or on search/filter change)
  useEffect(() => {
    loadChats(true);
  }, [projectId, debouncedSearch, activeCategoryIds.join(',')]);

  async function loadChats(reset: boolean) {
    const currentOffset = reset ? 0 : offsetRef.current;
    if (!reset) setLoadingMore(true);
    if (reset) {
      setInitialLoading(true);
      setHasMore(false);
    }

    try {
      const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '';
      const catParam = activeCategoryIds.length > 0
        ? `&categoryIds=${encodeURIComponent(activeCategoryIds.join(','))}`
        : '';
      const data = await api.get<{ chats: Chat[]; total: number }>(
        `/api/projects/${projectId}/chats?limit=${PAGE_SIZE}&offset=${currentOffset}${searchParam}${catParam}`
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
  }, [loadingMore, hasMore, projectId, debouncedSearch, activeCategoryIds.join(',')]);

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
    if (eligibleEnabledIds.length === 0) {
      // No mode-eligible adapters → navigate to catalog
      navigate('/catalog');
      return;
    }
    if (eligibleEnabledIds.length === 1) {
      // Only one eligible adapter → use it directly
      createChatWithAdapter(eligibleEnabledIds[0]);
      return;
    }
    // Use the project's default only if it's eligible in the current mode
    // (a stale claude-code default in simple mode falls through to the picker).
    const defaultAdapter = project?.defaultAdapter;
    if (defaultAdapter && eligibleEnabledIds.includes(defaultAdapter)) {
      createChatWithAdapter(defaultAdapter);
      return;
    }
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
    if (eligibleEnabledIds.length === 0) {
      navigate('/catalog');
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

  // "Mark as unread" used to be a manual menu item — removed in favour of the
  // tab-pin model. The unread *state* (auto-set when an agent replies) is
  // still tracked by the activeChatsTracker and shown via unreadIds.

  // Sidebar tab toggles. Optimistic — server broadcast via useSidebarSync
  // returns and we de-dupe.
  function handlePinToSidebar(chat: Chat) {
    const now = new Date().toISOString();
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, tabPinnedAt: now, tabOpenedAt: c.tabOpenedAt ?? now } : c));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/tab`, { pinned: true }).catch(() => {});
  }
  function handleUnpinFromSidebar(chat: Chat) {
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, tabPinnedAt: null } : c));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/tab`, { pinned: false }).catch(() => {});
  }
  function handleCloseTab(chat: Chat) {
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, tabOpenedAt: null, tabPinnedAt: null } : c));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/tab`, { opened: false }).catch(() => {});
  }
  function handleOpenInSidebar(chat: Chat) {
    const now = new Date().toISOString();
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, tabOpenedAt: now } : c));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/tab`, { opened: true }).catch(() => {});
  }

  // Desktop hover popover: show extra actions (favorite, unread, view summary)
  // after a short hover delay, mirroring the sidebar hover pattern.
  useEffect(() => () => {
    if (hoverShowRef.current) clearTimeout(hoverShowRef.current);
    if (hoverHideRef.current) clearTimeout(hoverHideRef.current);
  }, []);

  function handleRowMouseEnter(e: React.MouseEvent, chat: Chat) {
    if (isMobile) return;
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.right - 24;
    const y = rect.bottom + 4;
    hoverShowRef.current = setTimeout(() => {
      setHoverCtx({ chat, x, y });
      hoverShowRef.current = null;
    }, 350);
  }

  function handleRowMouseLeave() {
    if (isMobile) return;
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    hoverHideRef.current = setTimeout(() => {
      setHoverCtx(null);
      hoverHideRef.current = null;
    }, 300);
  }

  function handleHoverPopoverMouseEnter() {
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
  }

  function handleHoverPopoverMouseLeave() {
    hoverHideRef.current = setTimeout(() => {
      setHoverCtx(null);
      hoverHideRef.current = null;
    }, 300);
  }

  // Mobile long-press: 500ms hold opens the same context popover. dnd-kit's TouchSensor
  // also arms at 500ms — if the user then moves, onDragStart cancels this popover.
  function handleRowLongPressStart(e: ReactTouchEvent, chat: Chat) {
    if (!isMobile) return;
    const t = e.touches[0];
    longPressOrigin.current = { x: t.clientX, y: t.clientY };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(t.clientX, rect.right - 24);
    const y = rect.bottom + 4;
    longPressTimer.current = setTimeout(() => {
      haptics.impactMedium();
      setHoverCtx({ chat, x, y });
      longPressTimer.current = null;
    }, 500);
  }

  function handleRowLongPressMove(e: ReactTouchEvent) {
    if (!longPressOrigin.current || !longPressTimer.current) return;
    const dx = e.touches[0].clientX - longPressOrigin.current.x;
    const dy = e.touches[0].clientY - longPressOrigin.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleRowLongPressEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  }

  // Fetch categories on project change.
  useEffect(() => {
    let cancelled = false;
    api.get<{ categories: ChatCategory[] }>(`/api/projects/${projectId}/categories`)
      .then(data => { if (!cancelled) setCategories(data.categories || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  function handleSetChatCategory(chat: Chat, categoryId: string | null) {
    const targetCat = categoryId ? categories.find(c => c.id === categoryId) ?? null : null;
    // Optimistic local update.
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, categoryId, category: targetCat } : c));
    api.put(`/api/projects/${projectId}/chats/${chat.id}/category`, { categoryId }).catch(() => {
      // Revert on error
      setChats(prev => prev.map(c => c.id === chat.id ? { ...c, categoryId: chat.categoryId, category: chat.category } : c));
    });
  }

  function toggleCategoryFilter(categoryId: string) {
    setActiveCategoryIds(prev =>
      prev.includes(categoryId) ? prev.filter(id => id !== categoryId) : [...prev, categoryId]
    );
  }

  function clearCategoryFilter() {
    setActiveCategoryIds([]);
  }

  const showSearch = chats.length > 0 || searchQuery;

  // Group loaded chats into time buckets for the section-header layout.
  // Server already returns chats sorted by lastActivityAt DESC, so iterating
  // in-order and starting a new group whenever the bucket key changes
  // preserves order and naturally skips empty buckets.
  const groupedChats = useMemo(() => {
    const now = new Date();
    const groups: { bucket: ChatBucket; chats: Chat[] }[] = [];
    for (const chat of chats) {
      const bucket = getChatBucket(new Date(chat.lastActivityAt || chat.createdAt), now);
      const last = groups[groups.length - 1];
      if (last && last.bucket.key === bucket.key) {
        last.chats.push(chat);
      } else {
        groups.push({ bucket, chats: [chat] });
      }
    }
    return groups;
  }, [chats]);

  return (
    <PullToRefresh onRefresh={() => loadChats(true)} className="p-4 space-y-3">
      <div className="flex gap-1">
        {adaptersLoading ? (
          <div className="h-9 w-full rounded-md border border-border bg-transparent" />
        ) : (
          <>
            <Button onClick={handleNewChat} disabled={creating} variant="outline" className="flex-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {creating ? 'Creating...' : 'New Chat'}
            </Button>
            {eligibleEnabledIds.length > 1 && (
              <Button onClick={handleForcePickerOpen} disabled={creating} variant="outline" className="px-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </Button>
            )}
          </>
        )}
      </div>

      {/* Adapter picker sheet — mode controls which adapters are offered. */}
      <NewChatPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        enabledAdapters={adapterInfos
          .filter(a => a.enabled)
          // Simple-mode workspaces show every enabled message-based adapter.
          // Terminal-only adapters (claude-code) stay dev-only.
          .filter(a => project?.mode === 'dev' || !a.metadata.capabilities.terminal)
          .map(a => ({ metadata: a.metadata }))}
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

      {/* Category filter chips. "All" clears the filter; each category toggles
          itself in/out of the active filter set. The "+" button opens the
          manager modal. */}
      {(showSearch || categories.length > 0) && (
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          <button
            onClick={clearCategoryFilter}
            className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              activeCategoryIds.length === 0
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'border-border text-text-dim hover:text-text hover:bg-bg-hover'
            }`}
          >
            All
          </button>
          {categories.map(cat => {
            const active = activeCategoryIds.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategoryFilter(cat.id)}
                className={`flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'border-border text-text-dim hover:text-text hover:bg-bg-hover'
                }`}
              >
                <span aria-hidden>{cat.emoji}</span>
                <span>{cat.name}</span>
              </button>
            );
          })}
          <button
            onClick={() => setManagerOpen(true)}
            className="flex-shrink-0 text-xs px-2 py-1 rounded-full border border-dashed border-border text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
            aria-label="Manage categories"
            title="Manage categories"
          >
            +
          </button>
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
                    onClick={() => navigate('/catalog')}
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
        <>
          {groupedChats.map((group) => (
            <Fragment key={group.bucket.key}>
              <div className="px-1 pt-2 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-text-dim">
                {group.bucket.label}
              </div>
              {group.chats.map((chat) => (
            <SwipeableRow
              key={chat.id}
              // Mobile no longer uses swipe — long-press opens the full action popover.
              {...(isMobile
                ? {}
                : {
                    onDelete: () => setDeleteTarget(chat),
                  }
              )}
            >
            <ChatCard
              onClick={() => goToChat(chat.id)}
              onMouseEnter={(e) => handleRowMouseEnter(e, chat)}
              onMouseLeave={handleRowMouseLeave}
              onLongPressStart={(e) => handleRowLongPressStart(e, chat)}
              onLongPressMove={handleRowLongPressMove}
              onLongPressEnd={handleRowLongPressEnd}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {chat.tabPinnedAt ? (
                      <svg className="flex-shrink-0 w-3.5 h-3.5 text-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 12V4m0 0H8m8 0l-4 4m-3 9l-3 3m0 0v-6h6m-3 3l9-9" />
                      </svg>
                    ) : chat.category ? (
                      <span className="flex-shrink-0 text-[13px] leading-none" aria-hidden>{chat.category.emoji}</span>
                    ) : unreadIds.has(chat.id) ? (
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-primary" />
                    ) : null}
                    <h4 className={`font-medium group-hover-hover:text-primary transition-colors truncate ${chat.tabPinnedAt ? 'text-text font-bold' : unreadIds.has(chat.id) ? 'text-text font-semibold' : 'text-text'}`}>
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
                    <span>{formatChatTime(chat.lastActivityAt || chat.createdAt, group.bucket.key)}</span>
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
                  {/* Info icon — mobile only (desktop exposes "View summary" via hover popover) */}
                  {isMobile && chat.description && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInfoChat(chat); }}
                      className="w-8 h-8 flex items-center justify-center rounded text-text-dim hover-hover:text-primary hover-hover:bg-bg-hover transition-all"
                      aria-label="Chat summary"
                      title="View summary"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            </ChatCard>
            </SwipeableRow>
              ))}
            </Fragment>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} />
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </>
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

      {/* Desktop hover popover — extra per-chat actions (favorite, unread, view summary). */}
      <ContextMenu
        open={!!hoverCtx}
        onClose={() => setHoverCtx(null)}
        position={{ x: hoverCtx?.x || 0, y: hoverCtx?.y || 0 }}
        showBackdrop={false}
        onMouseEnter={handleHoverPopoverMouseEnter}
        onMouseLeave={handleHoverPopoverMouseLeave}
        items={hoverCtx ? [
          ...(hoverCtx.chat.description ? [{
            label: 'View summary',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>,
            onAction: () => setInfoChat(hoverCtx.chat),
          }] : []),
          // Category picker — flat list. Click the active one to clear it.
          ...categories.map(cat => ({
            label: `${cat.emoji}  ${cat.name}${hoverCtx.chat.categoryId === cat.id ? '  ✓' : ''}`,
            onAction: () => {
              const next = hoverCtx.chat.categoryId === cat.id ? null : cat.id;
              handleSetChatCategory(hoverCtx.chat, next);
            },
          })),
          {
            label: 'Manage categories…',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
            onAction: () => setManagerOpen(true),
          },
          // Sidebar tab actions — Pin/Unpin (sticky), Open/Close (dismissable
          // tab). Auto-reopen still applies if the closed chat gets a reply.
          hoverCtx.chat.tabPinnedAt ? {
            label: 'Unpin from sidebar',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M9 9v6m6-6v6M5 7h14l-1 12H6L5 7zm2-4h10" /></svg>,
            onAction: () => handleUnpinFromSidebar(hoverCtx.chat),
          } : {
            label: 'Pin to sidebar',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 12V4m0 0H8m8 0l-4 4m-3 9l-3 3m0 0v-6h6m-3 3l9-9" /></svg>,
            onAction: () => handlePinToSidebar(hoverCtx.chat),
          },
          ...(hoverCtx.chat.tabPinnedAt ? [] : [
            hoverCtx.chat.tabOpenedAt ? {
              label: 'Close tab',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
              onAction: () => handleCloseTab(hoverCtx.chat),
            } : {
              label: 'Open in sidebar',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>,
              onAction: () => handleOpenInSidebar(hoverCtx.chat),
            },
          ]),
          // Edit + Delete only appear on mobile here — desktop already has them inline.
          ...(isMobile ? [
            {
              label: 'Rename',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>,
              onAction: () => { setRenameTarget(hoverCtx.chat); setRenameValue(hoverCtx.chat.label); },
            },
            {
              label: 'Auto generate title',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>,
              onAction: () => handleGenerateTitle(hoverCtx.chat),
            },
            {
              label: 'Delete',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
              variant: 'danger' as const,
              onAction: () => { haptics.notificationWarning(); setDeleteTarget(hoverCtx.chat); },
            },
          ] : []),
        ] : []}
      />

      <CategoryManager
        open={managerOpen}
        onOpenChange={(open) => {
          setManagerOpen(open);
          // Re-fetch chats when the manager closes — a deleted category
          // would otherwise leave stale `category` objects on local rows.
          if (!open) loadChats(true);
        }}
        projectId={projectId}
        categories={categories}
        onChange={setCategories}
      />
    </PullToRefresh>
  );
}
