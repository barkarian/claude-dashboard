import { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef, useMemo, type TouchEvent as ReactTouchEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDesktopUpdate } from '../../context/DesktopUpdateContext.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { Separator } from '../ui/separator.tsx';
import {
  SIDEBAR_WIDTH_MOBILE,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar.tsx';
import api from '../../utils/api.ts';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.ts';
import PullToRefresh from '../ui/PullToRefresh.tsx';
import ContextMenu from '../ui/ContextMenu.tsx';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../ui/alert-dialog.tsx';
import { haptics } from '../../utils/haptics.ts';
import type { Chat, ChatCategory, ProjectSummary } from '../../../../shared/types/models.ts';
import { useProject } from '../../context/ProjectContext.tsx';
import type { ActiveChat } from '../../../../shared/types/socket-events.ts';
import EnvironmentToggle from './EnvironmentToggle.tsx';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import { useGlobalActiveChats } from '../../hooks/useGlobalActiveChats.ts';
import { useNewAgent } from '../../hooks/useNewAgent.ts';

export interface SidebarHandle {
  refreshProjects: () => void;
}

const PAGE_SIZE = 5;

// Status dot colors for active chats
function statusDotClass(status: ActiveChat['status']): string {
  switch (status) {
    case 'working':
      return 'bg-[#f97316] animate-pulse'; // orange pulsing (thinking)
    case 'question-awaiting':
    case 'questions-awaiting':
    case 'plan-awaiting':
    case 'permission-awaiting':
      return 'bg-[#a855f7] animate-pulse'; // purple pulsing (awaiting user)
    case 'unread':
      return 'bg-success'; // solid green (new reply)
    default:
      return 'bg-border';
  }
}

function statusLabel(status: ActiveChat['status']): string {
  switch (status) {
    case 'working': return 'Thinking';
    case 'question-awaiting':
    case 'questions-awaiting': return 'Question';
    case 'plan-awaiting': return 'Plan';
    case 'permission-awaiting': return 'Permission';
    case 'unread': return 'New reply';
    default: return '';
  }
}

function isAwaitingStatus(status: ActiveChat['status']): boolean {
  return status === 'question-awaiting' || status === 'questions-awaiting' ||
    status === 'plan-awaiting' || status === 'permission-awaiting';
}

// Badge color: purple if any awaiting, green if all replies (excludes plain working from count)
function badgeClass(chats: ActiveChat[]): string {
  const counted = chats.filter(c => c.status === 'unread' || isAwaitingStatus(c.status));
  if (counted.length === 0) return 'bg-border text-text-dim';
  if (counted.some(c => isAwaitingStatus(c.status))) return 'bg-[#a855f7] text-white'; // purple
  return 'bg-success text-white'; // green (all new replies)
}

// Badge count: only new replies + awaiting (not plain thinking)
function badgeCount(chats: ActiveChat[]): number {
  return chats.filter(c => c.status === 'unread' || isAwaitingStatus(c.status)).length;
}

interface ChatRowProps {
  chat: SidebarChatRow;
  isActive: boolean;
  onSelect: () => void;
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchEndCancel: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onContextMenuNative: (e: React.MouseEvent) => void;
}

function ChatRow({
  chat, isActive, onSelect, onTouchStart, onTouchEndCancel,
  onMouseEnter, onMouseLeave, onContextMenuNative,
}: ChatRowProps) {
  // Category emoji acts as the inline marker. Falls back to the live status
  // dot when the chat is uncategorised. Idle (lazy-fetched) chats with no
  // category get a plain neutral dot.
  const marker = chat.categoryEmoji ? (
    <span className="text-[13px] leading-none flex-shrink-0" aria-hidden>{chat.categoryEmoji}</span>
  ) : chat.status === 'idle' ? (
    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-border" />
  ) : (
    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(chat.status)}`} />
  );
  return (
    <li>
      <button
        onClick={onSelect}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEndCancel}
        onTouchMove={onTouchEndCancel}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenuNative}
        className={`w-full flex items-center gap-2 px-2 py-2 md:py-1 rounded-md text-base md:text-[13px] transition-colors hover:bg-bg-hover ${
          isActive ? 'bg-bg-hover text-text' : 'text-text-dim'
        }`}
      >
        {marker}
        <span className="truncate flex-1 text-left">{chat.label}</span>
        {chat.status !== 'idle' && (
          <span className="flex-shrink-0 text-[9px] opacity-70">
            {statusLabel(chat.status as ActiveChat['status'])}
          </span>
        )}
      </button>
    </li>
  );
}

// How many chats to load per "Show more" tap when paging through a project's
// full chat list (lazy-fetched into the sidebar on expand).
const CHATS_PER_PAGE = 5;

const ACTIONABLE_STATUSES = new Set<string>([
  'working',
  'question-awaiting',
  'questions-awaiting',
  'plan-awaiting',
  'permission-awaiting',
  'unread',
]);

interface SidebarChatRow {
  chatId: string;
  label: string;
  status: ActiveChat['status'] | 'idle';
  categoryId: string | null;
  categoryEmoji: string | null;
  lastActivityAt: string;
}

/** Merge live tracker chats with lazy-fetched idle chats. Tracker entries
 * win on duplicate id (they have fresh status). Sorted by activity desc. */
function mergeProjectChats(tracker: ActiveChat[], fetched: Chat[]): SidebarChatRow[] {
  const byId = new Map<string, SidebarChatRow>();
  for (const f of fetched) {
    byId.set(f.id, {
      chatId: f.id,
      label: f.label,
      status: 'idle',
      categoryId: f.categoryId,
      categoryEmoji: f.category?.emoji ?? null,
      lastActivityAt: f.lastActivityAt || f.createdAt,
    });
  }
  for (const t of tracker) {
    byId.set(t.chatId, {
      chatId: t.chatId,
      label: t.label,
      status: t.status,
      categoryId: t.categoryId,
      categoryEmoji: t.categoryEmoji,
      lastActivityAt: t.lastActivityAt,
    });
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
}

// Drag wrappers. The whole row is the drag handle — the activation
// constraints (PointerSensor distance, TouchSensor delay) make sure a click
// or scroll never triggers a drag. While dragging, opacity drops so the user
// sees the source row dimming as they move.
// Suppress Capacitor / iOS WebKit's native long-press callout (the "Open in
// Browser / Copy Link" sheet) over draggable rows. Without this, holding to
// drag opens the WebView's link menu instead of arming our drag.
const NO_CALLOUT_STYLE: React.CSSProperties = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  touchAction: 'manipulation',
};

// Drag attributes/listeners/refs are attached only to the project's inner
// row div — never to the SidebarMenuItem itself — so the expanded chat list
// underneath stays put when the row is dragged.
type RowDragProps = {
  setNodeRef: (el: HTMLElement | null) => void;
  attributes: Record<string, unknown>;
  listeners: Record<string, (e: unknown) => void> | undefined;
  style: React.CSSProperties;
};

function mergeHandlers<E>(...fns: Array<((e: E) => void) | undefined>) {
  return (e: E) => { for (const f of fns) f?.(e); };
}

function SortableProjectItem({ id, render }: {
  id: string;
  render: (drag: RowDragProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return <>{render({
    setNodeRef,
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, (e: unknown) => void> | undefined,
    style,
  })}</>;
}

function DraggableProjectItem({ id, render }: {
  id: string;
  render: (drag: RowDragProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return <>{render({
    setNodeRef,
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, (e: unknown) => void> | undefined,
    style,
  })}</>;
}

function DroppableZone({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} ${isOver ? 'bg-primary/5 ring-1 ring-primary/30 rounded-md transition-colors' : ''}`}
    >
      {children}
    </div>
  );
}

const AppSidebar = forwardRef<SidebarHandle>(function AppSidebar(_props, ref) {
  const { user, logout, isDesktop, tunnelUrl } = useAuth();
  const { updateAvailable } = useDesktopUpdate();
  const { setOpenMobile, openMobile, isMobile, sidebarWidth } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { openDrawer } = useNewProjectDrawer();
  const { startNewAgent } = useNewAgent();
  const activeChats = useGlobalActiveChats();
  const { setProject } = useProject();

  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);

  // Context menu and delete confirmation state for sidebar chat long-press
  const [sidebarCtx, setSidebarCtx] = useState<{ chat: SidebarChatRow; projectId: string; projectPath: string; x: number; y: number; trigger: 'longpress' | 'hover' } | null>(null);
  const [sidebarDeleteTarget, setSidebarDeleteTarget] = useState<{ chat: SidebarChatRow; projectId: string } | null>(null);
  const sidebarLongPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ideMenu, setIdeMenu] = useState<{ projectPath: string; x: number; y: number } | null>(null);
  // Project-level long-press / right-click menu (Pin/Unpin + IDE on desktop).
  const [projectMenu, setProjectMenu] = useState<{ project: ProjectSummary; x: number; y: number } | null>(null);
  const projectLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True only while a Recents item is mid-drag — used to reveal the Pinned
  // drop zone when no pinned items exist yet, so first-time pinning via drag
  // is discoverable.
  const [isDraggingFromRecents, setIsDraggingFromRecents] = useState(false);
  const hoverShowRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close popovers/menus when mobile sidebar closes — without this, a long-
  // press menu opened in one drawer-open session can persist into the next.
  useEffect(() => {
    if (isMobile && !openMobile) {
      setSidebarCtx(null);
      setProjectMenu(null);
      setIdeMenu(null);
    }
  }, [openMobile, isMobile]);

  // Per-project categories are fetched lazily (only when the popover opens for
  // a chat in that project). Cached so back-to-back menus reuse the same list.
  const [categoriesByProject, setCategoriesByProject] = useState<Record<string, ChatCategory[]>>({});
  const fetchProjectCategories = useCallback(async (projectId: string): Promise<ChatCategory[]> => {
    if (categoriesByProject[projectId]) return categoriesByProject[projectId];
    try {
      const data = await api.get<{ categories: ChatCategory[] }>(`/api/projects/${projectId}/categories`);
      const cats = data.categories || [];
      setCategoriesByProject(prev => ({ ...prev, [projectId]: cats }));
      return cats;
    } catch {
      return [];
    }
  }, [categoriesByProject]);

  function setChatCategory(projectId: string, chatId: string, categoryId: string | null) {
    api.put(`/api/projects/${projectId}/chats/${chatId}/category`, { categoryId }).catch(() => {});
  }

  // Lazy-loaded per-project chat lists. Sidebar only knows about live
  // actionable chats by default (via the socket tracker); when the user
  // expands a project we paginate through its real chat list so they can
  // see idle chats too with "Show more".
  const [chatsByProject, setChatsByProject] = useState<Record<string, { chats: Chat[]; total: number }>>({});
  const [chatsLoadingProject, setChatsLoadingProject] = useState<Set<string>>(new Set());

  const fetchProjectChats = useCallback(async (projectId: string, more: boolean, coverActivityAt?: string) => {
    setChatsLoadingProject(prev => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    try {
      const offset = more ? (chatsByProject[projectId]?.chats.length ?? 0) : 0;
      const params = new URLSearchParams({ limit: String(CHATS_PER_PAGE), offset: String(offset) });
      if (!more && coverActivityAt) params.set('coverActivityAt', coverActivityAt);
      const data = await api.get<{ chats: Chat[]; total: number }>(
        `/api/projects/${projectId}/chats?${params.toString()}`
      );
      const fetched = data.chats || [];
      setChatsByProject(prev => {
        const existing = prev[projectId]?.chats ?? [];
        // Dedupe by id when paging (server might return one we already had).
        const seen = new Set(more ? existing.map(c => c.id) : []);
        const merged = more
          ? [...existing, ...fetched.filter(c => !seen.has(c.id))]
          : fetched;
        return { ...prev, [projectId]: { chats: merged, total: data.total ?? merged.length } };
      });
    } catch {
      // ignore — sidebar shouldn't surface errors here
    } finally {
      setChatsLoadingProject(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, [chatsByProject]);

  // Cleanup hover timers
  useEffect(() => () => {
    if (hoverShowRef.current) clearTimeout(hoverShowRef.current);
    if (hoverHideRef.current) clearTimeout(hoverHideRef.current);
  }, []);

  function handleSidebarChatTouchStart(e: ReactTouchEvent, chat: SidebarChatRow, projectId: string, projectPath: string) {
    const touch = e.touches[0];
    sidebarLongPress.current = setTimeout(() => {
      haptics.impactLight();
      setSidebarCtx({ chat, projectId, projectPath, x: touch.clientX, y: touch.clientY, trigger: 'longpress' });
      fetchProjectCategories(projectId);
    }, 500);
  }
  function handleSidebarChatTouchEndCancel() {
    if (sidebarLongPress.current) {
      clearTimeout(sidebarLongPress.current);
      sidebarLongPress.current = null;
    }
  }

  // Desktop: hover to show popover
  function handleChatMouseEnter(e: React.MouseEvent, chat: SidebarChatRow, projectId: string, projectPath: string) {
    if (isMobile || ideMenu) return;
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverShowRef.current = setTimeout(() => {
      setSidebarCtx({ chat, projectId, projectPath, x: rect.right + 4, y: rect.top, trigger: 'hover' });
      fetchProjectCategories(projectId);
      hoverShowRef.current = null;
    }, 150);
  }

  function handleChatMouseLeave() {
    if (isMobile) return;
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    hoverHideRef.current = setTimeout(() => {
      setSidebarCtx(prev => prev?.trigger === 'hover' ? null : prev);
      hoverHideRef.current = null;
    }, 500);
  }

  function handlePopoverMouseEnter() {
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
  }

  function handlePopoverMouseLeave() {
    hoverHideRef.current = setTimeout(() => {
      setSidebarCtx(prev => prev?.trigger === 'hover' ? null : prev);
      hoverHideRef.current = null;
    }, 500);
  }

  // Desktop app: right-click on a chat row → open in IDE/Finder. Stops
  // propagation so the project row's onContextMenu (which opens the project
  // menu) doesn't also fire on the same right-click.
  function handleChatContextMenu(e: React.MouseEvent, projectPath: string) {
    if (!isDesktop || isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setSidebarCtx(null);
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
    setIdeMenu({ projectPath, x: e.clientX, y: e.clientY });
  }

  // ── Pin / Unpin / Reorder ──────────────────────────────────────────────
  // The Pinned section is manually ordered; Recents excludes anything pinned.
  // We update local state optimistically so the drag and the menu both feel
  // immediate, then reconcile with the server. On error we re-fetch.

  const sortByActivity = useCallback((a: ProjectSummary, b: ProjectSummary) => {
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  }, []);

  const pinProject = useCallback(async (project: ProjectSummary, atIndex?: number) => {
    const updated: ProjectSummary = {
      ...project,
      pinned: true,
      pinnedAt: new Date().toISOString(),
    };
    let nextOrder: ProjectSummary[] = [];
    setPinnedProjects(prev => {
      const without = prev.filter(p => p.id !== project.id);
      const idx = atIndex !== undefined ? Math.max(0, Math.min(atIndex, without.length)) : without.length;
      nextOrder = [...without];
      nextOrder.splice(idx, 0, updated);
      return nextOrder;
    });
    setProjects(prev => prev.filter(p => p.id !== project.id));
    try {
      await api.patch(`/api/projects/${project.id}`, { pinned: true });
      // Reorder writes synthetic timestamps so the server returns the same
      // order on next reload.
      await api.post('/api/projects/reorder-pinned', { orderedIds: nextOrder.map(p => p.id) });
    } catch {
      loadInitial();
    }
  }, []);

  const unpinProject = useCallback(async (project: ProjectSummary) => {
    setPinnedProjects(prev => prev.filter(p => p.id !== project.id));
    setProjects(prev => {
      if (prev.some(p => p.id === project.id)) return prev;
      const updated: ProjectSummary = { ...project, pinned: false, pinnedAt: null };
      return [...prev, updated].sort(sortByActivity);
    });
    try {
      await api.patch(`/api/projects/${project.id}`, { pinned: false });
    } catch {
      loadInitial();
    }
  }, [sortByActivity]);

  const reorderPinned = useCallback(async (orderedIds: string[]) => {
    try {
      await api.post('/api/projects/reorder-pinned', { orderedIds });
    } catch {
      loadInitial();
    }
  }, []);

  // ── DnD wiring ────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // 250ms hold + 8px tolerance so the page can still scroll on touch:
    // a tap navigates, a long-hold opens the project menu (500ms), and a
    // press-then-drag arms a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    // Cancel any pending long-press menu so a drag never coexists with the menu.
    if (projectLongPressRef.current) {
      clearTimeout(projectLongPressRef.current);
      projectLongPressRef.current = null;
    }
    const id = String(e.active.id);
    setIsDraggingFromRecents(projects.some(p => p.id === id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setIsDraggingFromRecents(false);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const fromPinned = pinnedProjects.find(p => p.id === activeId);
    const fromRecents = projects.find(p => p.id === activeId);
    const overInPinned = pinnedProjects.findIndex(p => p.id === overId);
    const overIsPinnedZone = overId === 'pinned-zone' || overInPinned >= 0;
    const overIsRecentsZone = overId === 'recents-zone' || projects.some(p => p.id === overId);

    if (fromPinned && overIsPinnedZone) {
      // Reorder within Pinned. Drop on the pinned-zone droppable means "end".
      const oldIndex = pinnedProjects.findIndex(p => p.id === activeId);
      const newIndex = overInPinned >= 0 ? overInPinned : pinnedProjects.length - 1;
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const reordered = arrayMove(pinnedProjects, oldIndex, newIndex);
      setPinnedProjects(reordered);
      reorderPinned(reordered.map(p => p.id));
      return;
    }
    if (fromPinned && overIsRecentsZone) {
      // Whole-zone unpin: position in Recents is meaningless (auto-sorted),
      // we just unpin and let the activity-order reinsertion happen locally.
      unpinProject(fromPinned);
      return;
    }
    if (fromRecents && overIsPinnedZone) {
      const insertIndex = overInPinned >= 0 ? overInPinned : pinnedProjects.length;
      pinProject(fromRecents, insertIndex);
      return;
    }
    // Recents → Recents: no-op (Recents is auto-sorted by activity).
  }

  // Long-press / right-click on a project row → project menu (Pin/Unpin
  // + Open in IDE on desktop). Cancelled if the user drags or releases early.
  function handleProjectTouchStart(e: ReactTouchEvent, project: ProjectSummary) {
    const touch = e.touches[0];
    projectLongPressRef.current = setTimeout(() => {
      haptics.impactLight();
      setProjectMenu({ project, x: touch.clientX, y: touch.clientY });
    }, 500);
  }
  function handleProjectTouchEndCancel() {
    if (projectLongPressRef.current) {
      clearTimeout(projectLongPressRef.current);
      projectLongPressRef.current = null;
    }
  }
  function handleProjectContextMenu(e: React.MouseEvent, project: ProjectSummary) {
    if (isMobile) return;
    e.preventDefault();
    setProjectMenu({ project, x: e.clientX, y: e.clientY });
  }

  // Quick New Chat for a project
  async function handleQuickNewChat(projectId: string) {
    try {
      const data = await api.post<{ chat: Chat }>(`/api/projects/${projectId}/chats`, { label: 'New Chat' });
      const created = data.chat;
      setProject(prev => {
        if (!prev || prev.id !== projectId) return prev;
        const rest = prev.chats.filter(c => c.id !== created.id);
        return { ...prev, chats: [created, ...rest] };
      });
      setOpenMobile(false);
      navigate(`/project/${projectId}/chats/${created.id}`, {
        state: { isNewChat: true, adapter: created.adapter },
      });
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  // Track which project accordions are expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Per-project "bypass the 3+actionable cap" flag. Set when the user clicks
  // "Show more chats". Cleared whenever the project is collapsed so re-open
  // returns to the default 3-chat view.
  const [showAllChats, setShowAllChats] = useState<Set<string>>(new Set());

  // Oldest "interesting" tracker chat for a project — its lastActivityAt is
  // passed to the chats fetch so the server returns enough rows to render a
  // continuous list from the top down through that chat.
  const oldestActionableActivity = useCallback((projectId: string): string | undefined => {
    const list = activeChats.byProject[projectId]?.chats ?? [];
    if (list.length === 0) return undefined;
    let oldest: string | undefined;
    for (const c of list) {
      if (!ACTIONABLE_STATUSES.has(c.status)) continue;
      if (!oldest || new Date(c.lastActivityAt).getTime() < new Date(oldest).getTime()) {
        oldest = c.lastActivityAt;
      }
    }
    return oldest;
  }, [activeChats]);

  const toggleExpanded = useCallback((projectId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
        // Reset cap-bypass when collapsing.
        setShowAllChats(s => {
          if (!s.has(projectId)) return s;
          const n = new Set(s);
          n.delete(projectId);
          return n;
        });
      } else {
        next.add(projectId);
        // Lazy-fetch the project's chat list the first time it expands so
        // the user sees idle chats too, not just the actionable tracker set.
        if (!chatsByProject[projectId]) {
          fetchProjectChats(projectId, false, oldestActionableActivity(projectId));
        }
      }
      return next;
    });
  }, [chatsByProject, fetchProjectChats, oldestActionableActivity]);

  const accountSettingsUrl = tunnelUrl
    ? new URL('/settings', tunnelUrl).href
    : '/settings';

  function openAccountSettings(e: React.MouseEvent) {
    if (isDesktop && tunnelUrl) {
      e.preventDefault();
      api.post('/api/open-external', { url: accountSettingsUrl }).catch(() => {});
    }
  }

  // Pinned and Recents are two separate sections. Pinned is manually ordered
  // (drag-reorder writes pinned_at as the sort key on the server). Recents is
  // auto-sorted by last chat activity, descending, and excludes anything in
  // Pinned so workspaces never appear twice.
  const [pinnedProjects, setPinnedProjects] = useState<ProjectSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [home, setHome] = useState<ProjectSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);

  // Search state
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSummary[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadInitial();
  }, []);

  // Auto-close mobile drawer on navigation + clear search + close popovers
  useEffect(() => {
    setOpenMobile(false);
    setSidebarSearch('');
    setSearchResults(null);
    setAccountPopoverOpen(false);
    setProjectMenu(null);
    setIdeMenu(null);
    setSidebarCtx(null);
  }, [location.pathname]);

  // Close popover when mobile sidebar is dismissed
  useEffect(() => {
    if (!openMobile) setAccountPopoverOpen(false);
  }, [openMobile]);

  async function loadInitial() {
    // Fetch the Home workspace separately (only if it already exists — don't
    // auto-create just by rendering the sidebar). It pins to the very top.
    api.get<{ project: ProjectSummary | null }>(`/api/projects?home=if-exists`)
      .then(data => setHome(data.project ?? null))
      .catch(() => setHome(null));

    try {
      // Pinned + Recents in parallel. Recents excludes pinned so a project
      // never appears in both lists.
      const [pinnedData, recentData] = await Promise.all([
        api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?pinned=1`),
        api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=${PAGE_SIZE}&offset=0&excludePinned=1`),
      ]);
      setPinnedProjects(pinnedData.projects || []);
      const fetched = recentData.projects || [];
      setProjects(fetched);
      offsetRef.current = fetched.length;
      setHasMore(fetched.length < (recentData.total || 0));
    } catch {
      // ignore
    }
  }

  useImperativeHandle(ref, () => ({
    refreshProjects: loadInitial,
  }));

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const currentOffset = offsetRef.current;
      const data = await api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=${PAGE_SIZE}&offset=${currentOffset}&excludePinned=1`);
      const newProjects = data.projects || [];
      setProjects(prev => [...prev, ...newProjects]);
      const newOffset = currentOffset + newProjects.length;
      offsetRef.current = newOffset;
      setHasMore(newOffset < (data.total || 0));
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  const { sentinelRef } = useInfiniteScroll({ loadMore, hasMore, loading: loadingMore });

  // Local filtering of already-loaded projects (across both lists)
  const localFiltered = useMemo(() => {
    if (!sidebarSearch.trim()) return null;
    const q = sidebarSearch.toLowerCase();
    const all = [...pinnedProjects, ...projects];
    return all.filter(p => p.name.toLowerCase().includes(q));
  }, [sidebarSearch, pinnedProjects, projects]);

  // Debounced API search for full DB results
  function handleSidebarSearch(value: string) {
    setSidebarSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(() => {
      api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=20&offset=0&search=${encodeURIComponent(value)}`)
        .then((data) => setSearchResults(data.projects || []))
        .catch(() => {})
        .finally(() => setSearchLoading(false));
    }, 300);
  }

  // When searching, render a single flat list (no Pinned/Recents distinction).
  // Otherwise render the two sections separately. Home is filtered out
  // defensively in case the backend ever returns it in either list.
  const isSearching = !!sidebarSearch.trim();
  const searchDisplay = useMemo(() => {
    const list = searchResults ?? localFiltered ?? [];
    return list.filter(p => !home || p.id !== home.id);
  }, [searchResults, localFiltered, home]);

  const visiblePinned = useMemo(
    () => pinnedProjects.filter(p => !home || p.id !== home.id),
    [pinnedProjects, home],
  );
  const visibleRecents = useMemo(
    () => projects.filter(p => !home || p.id !== home.id),
    [projects, home],
  );

  // Home is rendered as the always-top, always-pinned row inside the Pinned
  // section whenever it exists. Hidden during search.
  const showInfiniteScroll = !isSearching;

  // Auto-expand the project that matches the current URL on mobile so the
  // user can see its chats when they re-open the drawer. Desktop additionally
  // auto-expands any project with live actionable chats so awaiting/working
  // chats stay visible without manual interaction.
  const activeProjectIdFromUrl = useMemo(() => {
    const m = location.pathname.match(/^\/project\/([^/]+)/);
    return m ? m[1] : null;
  }, [location.pathname]);

  useEffect(() => {
    const idsToExpand: string[] = [];
    if (activeProjectIdFromUrl) idsToExpand.push(activeProjectIdFromUrl);
    if (!isMobile) {
      for (const id of Object.keys(activeChats.byProject)) {
        if (activeChats.byProject[id].count > 0) idsToExpand.push(id);
      }
    }
    if (idsToExpand.length === 0) return;
    setExpanded(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of idsToExpand) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      return changed ? next : prev;
    });
    for (const id of idsToExpand) {
      if (!chatsByProject[id]) {
        fetchProjectChats(id, false, oldestActionableActivity(id));
      }
    }
  }, [isMobile, activeChats, activeProjectIdFromUrl, chatsByProject, fetchProjectChats, oldestActionableActivity]);

  // Reusable project row renderer. Used for Home, Pinned, Recents, and search
  // results. When `drag` is provided, the DnD ref/listeners are attached to
  // the inner row div only — never to the wrapping SidebarMenuItem — so the
  // expanded chat list underneath stays put while the row is being dragged.
  const renderProjectRow = (project: ProjectSummary, drag?: RowDragProps) => {
    const projectActive = activeChats.byProject[project.id];
    const count = projectActive?.count || 0;
    const isExpanded = expanded.has(project.id);
    const isActive = location.pathname.startsWith(`/project/${project.id}`);
    const isHome = home?.id === project.id;
    // Always offer the expand arrow when the project has *any* chats.
    const hasAnyChats = count > 0 || (project.chatsCount ?? 0) > 0;

    return (
      <SidebarMenuItem key={project.id}>
        <div
          ref={drag?.setNodeRef}
          className="flex items-center w-full"
          style={{ ...NO_CALLOUT_STYLE, ...(drag?.style ?? {}) }}
          {...(drag?.attributes ?? {})}
          onPointerDown={drag?.listeners?.onPointerDown as ((e: React.PointerEvent) => void) | undefined}
          onContextMenu={(e) => handleProjectContextMenu(e, project)}
          onTouchStart={mergeHandlers<React.TouchEvent>(
            drag?.listeners?.onTouchStart as ((e: React.TouchEvent) => void) | undefined,
            (e) => handleProjectTouchStart(e, project),
          )}
          onTouchEnd={mergeHandlers<React.TouchEvent>(
            drag?.listeners?.onTouchEnd as ((e: React.TouchEvent) => void) | undefined,
            handleProjectTouchEndCancel,
          )}
          onTouchMove={mergeHandlers<React.TouchEvent>(
            drag?.listeners?.onTouchMove as ((e: React.TouchEvent) => void) | undefined,
            handleProjectTouchEndCancel,
          )}
          onTouchCancel={mergeHandlers<React.TouchEvent>(
            drag?.listeners?.onTouchCancel as ((e: React.TouchEvent) => void) | undefined,
            handleProjectTouchEndCancel,
          )}
        >
          {/* Expand/collapse toggle */}
          {hasAnyChats ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(project.id); }}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-text-dim hover:text-text transition-colors"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
              {isHome ? (
                <svg className="w-3.5 h-3.5 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
              ) : (
                <span className="w-2 h-2 rounded-full bg-border" />
              )}
            </span>
          )}

          {/* Project link */}
          <SidebarMenuButton asChild isActive={isActive} className="flex-1 min-w-0 text-base h-10 md:text-[15px] md:h-9">
            <NavLink to={`/project/${project.id}`} className="flex items-center gap-2">
              <span className="truncate">{project.name}</span>
              {count > 0 && (
                <span className={`ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${badgeClass(projectActive.chats)}`}>
                  {badgeCount(projectActive.chats) || count}
                </span>
              )}
            </NavLink>
          </SidebarMenuButton>

          {/* Quick New Chat button */}
          <button
            onClick={(e) => { e.stopPropagation(); handleQuickNewChat(project.id); }}
            className="flex-shrink-0 w-7 h-7 md:w-5 md:h-5 flex items-center justify-center rounded text-text-dim hover:text-primary hover:bg-bg-hover transition-colors"
            aria-label="New chat"
            title="New chat"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>

        {/* Expanded chat list. Default cap = max(5, deepest actionable + 1)
            so any working/awaiting/unread chat stays visible no matter how
            far back it sits, and the rendered list is continuous down to
            it. Quiet chats past that collapse behind "Show more". */}
        {hasAnyChats && isExpanded && (() => {
          const trackerChats = projectActive?.chats ?? [];
          const fetched = chatsByProject[project.id]?.chats ?? [];
          const total = chatsByProject[project.id]?.total ?? trackerChats.length;
          const merged = mergeProjectChats(trackerChats, fetched);
          const isLoading = chatsLoadingProject.has(project.id);
          const showAll = showAllChats.has(project.id);

          // Deepest actionable entry (working / awaiting / unread).
          let deepestActionable = -1;
          for (let i = 0; i < merged.length; i++) {
            if (ACTIONABLE_STATUSES.has(merged[i].status)) deepestActionable = i;
          }
          const cap = Math.max(5, deepestActionable + 1);
          const visible = showAll ? merged : merged.slice(0, cap);
          const hiddenInCap = !showAll && merged.length > cap;
          const hasMoreOnServer = fetched.length < total;
          // Show "Show more" if either there are merged chats hidden by the
          // cap, or there's more on the server we haven't fetched yet.
          const canShowMore = hiddenInCap || hasMoreOnServer;
          // Show "Show fewer" only when bypass is active AND the cap would
          // actually hide something — otherwise it's a no-op button.
          const canShowFewer = showAll && merged.length > cap;

          function handleShowMore() {
            // First click reveals chats hidden by the cap. After that,
            // each click pages forward on the server.
            if (hiddenInCap) {
              setShowAllChats(prev => {
                const next = new Set(prev);
                next.add(project.id);
                return next;
              });
              // If the bypass is going to immediately demand more (we've
              // shown everything fetched), kick off a fetch right away.
              if (!hasMoreOnServer) return;
              if (merged.length >= fetched.length) fetchProjectChats(project.id, true);
              return;
            }
            if (hasMoreOnServer) {
              fetchProjectChats(project.id, true);
            }
          }

          function handleShowFewer() {
            setShowAllChats(prev => {
              if (!prev.has(project.id)) return prev;
              const next = new Set(prev);
              next.delete(project.id);
              return next;
            });
          }

          return (
            <ul className="ml-5 mt-0.5 mb-1 space-y-0.5">
              {visible.map((chat) => (
                <ChatRow
                  key={chat.chatId}
                  chat={chat}
                  isActive={location.pathname.includes(chat.chatId)}
                  onSelect={() => {
                    setOpenMobile(false);
                    navigate(`/project/${project.id}/chats/${chat.chatId}`);
                  }}
                  onTouchStart={(e) => handleSidebarChatTouchStart(e, chat, project.id, project.path)}
                  onTouchEndCancel={handleSidebarChatTouchEndCancel}
                  onMouseEnter={(e) => handleChatMouseEnter(e, chat, project.id, project.path)}
                  onMouseLeave={handleChatMouseLeave}
                  onContextMenuNative={(e) => handleChatContextMenu(e, project.path)}
                />
              ))}
              {isLoading && (
                <li className="flex justify-center py-1.5">
                  <div className="animate-spin w-3 h-3 border-2 border-primary border-t-transparent rounded-full" />
                </li>
              )}
              {!isLoading && canShowMore && (
                <li>
                  <button
                    onClick={handleShowMore}
                    className="w-full px-2 py-1.5 md:py-1 rounded-md text-left text-[12px] text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
                  >
                    Show more chats
                  </button>
                </li>
              )}
              {!isLoading && canShowFewer && (
                <li>
                  <button
                    onClick={handleShowFewer}
                    className="w-full px-2 py-1.5 md:py-1 rounded-md text-left text-[12px] text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
                  >
                    Show fewer
                  </button>
                </li>
              )}
            </ul>
          );
        })()}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-lg font-bold text-text flex items-center gap-2">
            <span className="w-9 h-9 md:w-8 md:h-8 bg-primary rounded-lg flex items-center justify-center text-white text-sm font-bold">C</span>
            Claude Dashboard
          </h1>
          <EnvironmentToggle />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Top-level entry points: New Agent (opens command box) + Catalog */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => { setOpenMobile(false); startNewAgent(); }}
                className="text-base h-10 md:text-sm md:h-8 text-primary"
                title="New Agent (⌘N)"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
                <span>New Agent</span>
                <kbd className="ml-auto text-[10px] text-text-dim font-mono opacity-70 hidden md:inline">⌘N</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname.startsWith('/catalog')} className="text-base h-10 md:text-sm md:h-8">
                <NavLink to="/catalog" className="flex items-center gap-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                  <span>Catalog</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Workspaces — Pinned (manual order, with Home always at top if it
            exists) + Recents (last-activity order).
            Wrapped in a single DndContext so drags can cross sections:
              · within Pinned: reorder
              · Pinned → Recents: unpin (whole-zone drop, position ignored)
              · Recents → Pinned: pin at the dropped position
            Search renders a flat list with no sections. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setIsDraggingFromRecents(false)}
        >
          <SidebarGroup>
            <SidebarGroupContent>
              <PullToRefresh onRefresh={loadInitial}>
              {/* Search input */}
              <div className="px-2 pb-2 relative">
                <input
                  type="text"
                  value={sidebarSearch}
                  onChange={(e) => handleSidebarSearch(e.target.value)}
                  placeholder="Search workspaces..."
                  className="w-full bg-bg-surface border border-border rounded-md px-2.5 py-2 pr-7 text-sm md:text-xs md:py-1.5 text-text placeholder:text-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                />
                {sidebarSearch && (
                  <button
                    onClick={() => handleSidebarSearch('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
                    aria-label="Clear search"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Search-mode flat list (no sections, no DnD) */}
              {isSearching && (
                <SidebarMenu>
                  {searchLoading && (
                    <li className="flex justify-center py-2">
                      <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                    </li>
                  )}
                  {searchDisplay.map((project) => renderProjectRow(project))}
                  {!searchLoading && searchDisplay.length === 0 && (
                    <li className="px-3 py-2 text-xs text-text-dim">No workspaces found</li>
                  )}
                </SidebarMenu>
              )}

              {/* Pinned section — rendered when:
                    · Home exists (Home is always the top row of Pinned), OR
                    · at least one workspace is pinned, OR
                    · a Recents item is being dragged (drop-target is revealed
                      so first-time pinning via drag is discoverable).
                  Home is rendered as a static row at the top — it can't be
                  dragged or unpinned. Pinned items below are sortable. */}
              {!isSearching && (home || visiblePinned.length > 0 || isDraggingFromRecents) && (
                <>
                  <SidebarGroupLabel className="uppercase tracking-wider text-text-dim">Pinned</SidebarGroupLabel>
                  <SortableContext items={visiblePinned.map(p => p.id)} strategy={verticalListSortingStrategy}>
                    <DroppableZone id="pinned-zone" className="px-1">
                      <SidebarMenu>
                        {home && renderProjectRow(home)}
                        {visiblePinned.map((project) => (
                          <SortableProjectItem
                            key={project.id}
                            id={project.id}
                            render={(drag) => renderProjectRow(project, drag)}
                          />
                        ))}
                        {!home && visiblePinned.length === 0 && isDraggingFromRecents && (
                          <li className="px-3 py-3 text-xs text-text-dim italic text-center border border-dashed border-border rounded-md">
                            Drop here to pin
                          </li>
                        )}
                      </SidebarMenu>
                    </DroppableZone>
                  </SortableContext>
                </>
              )}

              {/* Recents section — auto-sorted by last activity. The whole
                  zone is a droppable so a Pinned item dropped anywhere in it
                  unpins (drop position is ignored — Recents is auto-sorted). */}
              {!isSearching && (
                <>
                  {(home || visiblePinned.length > 0) && (
                    <SidebarGroupLabel className="uppercase tracking-wider text-text-dim mt-2">Recent</SidebarGroupLabel>
                  )}
                  <DroppableZone id="recents-zone" className="px-1 min-h-[40px]">
                    <SidebarMenu>
                      {visibleRecents.map((project) => (
                        <DraggableProjectItem
                          key={project.id}
                          id={project.id}
                          render={(drag) => renderProjectRow(project, drag)}
                        />
                      ))}
                      {visiblePinned.length === 0 && visibleRecents.length === 0 && (
                        <li className="px-3 py-3 text-xs text-text-muted leading-relaxed">
                          No workspaces yet. Create one below to start chatting with Claude on a folder.
                        </li>
                      )}
                      {showInfiniteScroll && <li><div ref={sentinelRef} /></li>}
                      {showInfiniteScroll && loadingMore && (
                        <li className="flex justify-center py-2">
                          <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        </li>
                      )}
                    </SidebarMenu>
                  </DroppableZone>
                </>
              )}

              {/* New Workspace — always at the bottom of the workspaces group. */}
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => { setOpenMobile(false); openDrawer(); }} className="text-text-muted text-lg h-12 md:text-sm md:h-8">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span>New Workspace</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              </PullToRefresh>
            </SidebarGroupContent>
          </SidebarGroup>
        </DndContext>

      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}>
        {user && (
          <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
            <PopoverTrigger asChild>
              <button className="w-full px-2 py-2.5 md:py-2 flex items-center gap-2 rounded-lg hover:bg-bg-hover transition-colors cursor-pointer text-left">
                <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
                <span className="text-sm md:text-xs font-medium text-text truncate">
                  {user.username}
                </span>
                <span className={`text-[11px] md:text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  user.plan === 'pro'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-border text-text-dim'
                }`}>
                  {user.plan === 'pro' ? 'PRO' : 'FREE'}
                </span>
                <svg className="w-4 h-4 md:w-3.5 md:h-3.5 ml-auto text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
                </svg>
              </button>
            </PopoverTrigger>

            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="p-2 rounded-xl"
              style={{ width: isMobile ? SIDEBAR_WIDTH_MOBILE : `${sidebarWidth}px` }}
            >
              {/* Account Settings */}
              <a
                href={accountSettingsUrl}
                onClick={(e) => {
                  openAccountSettings(e);
                  setAccountPopoverOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text hover:bg-bg-hover transition-colors"
              >
                <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Account Settings
              </a>

              {/* Settings */}
              <NavLink
                to="/settings"
                onClick={() => setAccountPopoverOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text hover:bg-bg-hover transition-colors"
              >
                <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.11v1.093c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="flex-1">Settings</span>
                {updateAvailable && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-[10px] font-medium text-primary">Update</span>
                  </span>
                )}
              </NavLink>

              <Separator className="my-1" />

              {/* Upgrade link for free users */}
              {user.plan !== 'pro' && (
                <a
                  href={accountSettingsUrl}
                  onClick={(e) => {
                    openAccountSettings(e);
                    setAccountPopoverOpen(false);
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-primary hover:bg-bg-hover transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  Upgrade to Pro
                </a>
              )}

              {/* Logout */}
              <button
                onClick={() => {
                  setAccountPopoverOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-danger hover:bg-bg-hover transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                {isDesktop ? 'Logout & Close Tunnel' : 'Logout'}
              </button>
            </PopoverContent>
          </Popover>
        )}
      </SidebarFooter>

      {/* Sidebar chat long-press / hover context menu */}
      <ContextMenu
        open={!!sidebarCtx}
        onClose={() => setSidebarCtx(null)}
        position={{ x: sidebarCtx?.x || 0, y: sidebarCtx?.y || 0 }}
        showBackdrop={sidebarCtx?.trigger !== 'hover'}
        onMouseEnter={sidebarCtx?.trigger === 'hover' ? handlePopoverMouseEnter : undefined}
        onMouseLeave={sidebarCtx?.trigger === 'hover' ? handlePopoverMouseLeave : undefined}
        header={sidebarCtx ? (
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text break-words">{sidebarCtx.chat.label}</p>
              {statusLabel(sidebarCtx.chat.status) && (
                <p className="text-xs text-text-muted mt-0.5">{statusLabel(sidebarCtx.chat.status)}</p>
              )}
            </div>
          </div>
        ) : undefined}
        items={sidebarCtx ? [
          // Category picker — flat list of project categories. Click to assign,
          // click the current one to remove. Falls back to a placeholder while
          // the cache loads to keep the menu rendered consistently.
          ...((categoriesByProject[sidebarCtx.projectId] || []).map(cat => ({
            label: `${cat.emoji}  ${cat.name}${sidebarCtx.chat.categoryId === cat.id ? '  ✓' : ''}`,
            onAction: () => {
              const next = sidebarCtx.chat.categoryId === cat.id ? null : cat.id;
              setChatCategory(sidebarCtx.projectId, sidebarCtx.chat.chatId, next);
            },
          }))),
          ...(sidebarCtx.chat.categoryId ? [{
            label: 'Remove category',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
            onAction: () => setChatCategory(sidebarCtx.projectId, sidebarCtx.chat.chatId, null),
          }] : []),
          ...(sidebarCtx.chat.status === 'unread' ? [] : [{
            label: 'Set as unread',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>,
            onAction: () => {
              api.put(`/api/projects/${sidebarCtx.projectId}/chats/${sidebarCtx.chat.chatId}/unread`).catch(() => {});
            },
          }]),
          {
            label: 'Delete',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
            variant: 'danger' as const,
            onAction: () => {
              haptics.notificationWarning();
              setSidebarDeleteTarget({ chat: sidebarCtx.chat, projectId: sidebarCtx.projectId });
            },
          },
        ] : []}
      />

      {/* Sidebar chat delete confirmation */}
      <AlertDialog open={!!sidebarDeleteTarget} onOpenChange={(open) => !open && setSidebarDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{sidebarDeleteTarget?.chat.label}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (sidebarDeleteTarget) {
                  const { projectId: pid, chat: target } = sidebarDeleteTarget;
                  haptics.notificationError();
                  // Optimistic local prune so the row vanishes immediately —
                  // the server tracker drops it via the DELETE response, but
                  // the lazy-fetched chatsByProject cache is local and would
                  // otherwise keep showing the row until reload.
                  setChatsByProject(prev => {
                    const entry = prev[pid];
                    if (!entry) return prev;
                    const filtered = entry.chats.filter(c => c.id !== target.chatId);
                    if (filtered.length === entry.chats.length) return prev;
                    return {
                      ...prev,
                      [pid]: { chats: filtered, total: Math.max(0, entry.total - 1) },
                    };
                  });
                  api.delete(`/api/projects/${pid}/chats/${target.chatId}`).catch(() => {});
                }
                setSidebarDeleteTarget(null);
              }}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Project long-press / right-click menu — Pin/Unpin (everywhere) +
          Open in IDE/Finder (desktop only). */}
      <ContextMenu
        open={!!projectMenu}
        onClose={() => setProjectMenu(null)}
        position={{ x: projectMenu?.x || 0, y: projectMenu?.y || 0 }}
        header={projectMenu ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text truncate">{projectMenu.project.name}</span>
          </div>
        ) : undefined}
        items={projectMenu ? [
          // Home is always rendered at the top of the Pinned section and can
          // never be unpinned, so suppress Pin/Unpin entirely for Home.
          ...(home && projectMenu.project.id === home.id ? [] : [
            projectMenu.project.pinned ? {
              label: 'Unpin',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M9 9v6m6-6v6M5 7h14l-1 12H6L5 7zm2-4h10" /></svg>,
              onAction: () => { unpinProject(projectMenu.project); },
            } : {
              label: 'Pin to top',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 12V4m0 0H8m8 0l-4 4m-3 9l-3 3m0 0v-6h6m-3 3l9-9" /></svg>,
              onAction: () => { pinProject(projectMenu.project, 0); },
            },
          ]),
          ...(isDesktop ? [
            {
              label: 'Open Folder',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: projectMenu.project.path, editor: 'finder' }).catch(() => {}); },
            },
            {
              label: 'Open in VS Code',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: projectMenu.project.path, editor: 'vscode' }).catch(() => {}); },
            },
            {
              label: 'Open in Cursor',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: projectMenu.project.path, editor: 'cursor' }).catch(() => {}); },
            },
          ] : []),
        ] : []}
      />

      {/* Desktop right-click: open in IDE / Finder */}
      {isDesktop && (
        <ContextMenu
          open={!!ideMenu}
          onClose={() => setIdeMenu(null)}
          position={{ x: ideMenu?.x || 0, y: ideMenu?.y || 0 }}
          items={ideMenu ? [
            {
              label: 'Open Folder',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: ideMenu.projectPath, editor: 'finder' }).catch(() => {}); },
            },
            {
              label: 'Open in VS Code',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: ideMenu.projectPath, editor: 'vscode' }).catch(() => {}); },
            },
            {
              label: 'Open in Cursor',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: ideMenu.projectPath, editor: 'cursor' }).catch(() => {}); },
            },
            {
              label: 'Open in Zed',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: ideMenu.projectPath, editor: 'zed' }).catch(() => {}); },
            },
            {
              label: 'Open in Windsurf',
              icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
              onAction: () => { api.post('/api/open-path', { path: ideMenu.projectPath, editor: 'windsurf' }).catch(() => {}); },
            },
          ] : []}
        />
      )}

    </Sidebar>
  );
});

export default AppSidebar;
