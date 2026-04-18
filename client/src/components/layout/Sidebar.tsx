import { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef, useMemo, type TouchEvent as ReactTouchEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  MouseSensor,
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
import type { Chat, ProjectSummary } from '../../../../shared/types/models.ts';
import { useProject } from '../../context/ProjectContext.tsx';
import type { ActiveChat } from '../../../../shared/types/socket-events.ts';
import EnvironmentToggle from './EnvironmentToggle.tsx';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import { useGlobalActiveChats } from '../../hooks/useGlobalActiveChats.ts';

export interface SidebarHandle {
  refreshProjects: () => void;
}

const PAGE_SIZE = 20;

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
    case 'new':
      return 'bg-text'; // black/white neutral (new chat, no messages)
    case 'seen':
      return 'bg-border'; // grey (already read)
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
    case 'new': return 'New';
    case 'seen': return ''; // handled by dismiss button
    default: return '';
  }
}

function isAwaitingStatus(status: ActiveChat['status']): boolean {
  return status === 'question-awaiting' || status === 'questions-awaiting' ||
    status === 'plan-awaiting' || status === 'permission-awaiting';
}

// Badge color: purple if any awaiting, green if all replies (excludes working/seen/new from count)
function badgeClass(chats: ActiveChat[]): string {
  const counted = chats.filter(c => c.status === 'unread' || isAwaitingStatus(c.status));
  if (counted.length === 0) return 'bg-border text-text-dim';
  if (counted.some(c => isAwaitingStatus(c.status))) return 'bg-[#a855f7] text-white'; // purple
  return 'bg-success text-white'; // green (all new replies)
}

// Badge count: only new replies + awaiting (not thinking, not seen, not new)
function badgeCount(chats: ActiveChat[]): number {
  return chats.filter(c => c.status === 'unread' || isAwaitingStatus(c.status)).length;
}

interface SortableChatRowProps {
  chat: ActiveChat;
  projectId: string;
  projectPath: string;
  isActive: boolean;
  isDismissible: boolean;
  onSelect: () => void;
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchEndCancel: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onContextMenuNative: (e: React.MouseEvent) => void;
  onDismiss: () => void;
}

function SortableChatRow({
  chat, isActive, isDismissible, onSelect, onTouchStart, onTouchEndCancel,
  onMouseEnter, onMouseLeave, onContextMenuNative, onDismiss,
}: SortableChatRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chat.chatId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const starOrDot = chat.favorite ? (
    <svg className="w-3 h-3 flex-shrink-0 text-warning" fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.967a1 1 0 00.95.69h4.175c.969 0 1.371 1.24.588 1.81l-3.378 2.455a1 1 0 00-.364 1.118l1.287 3.966c.3.922-.755 1.688-1.54 1.118l-3.378-2.454a1 1 0 00-1.175 0l-3.378 2.454c-.784.57-1.838-.196-1.539-1.118l1.287-3.966a1 1 0 00-.364-1.118L2.05 9.394c-.783-.57-.38-1.81.588-1.81h4.175a1 1 0 00.95-.69l1.286-3.967z" />
    </svg>
  ) : (
    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(chat.status)}`} />
  );
  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners}>
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
        {starOrDot}
        <span className="truncate flex-1 text-left">{chat.label}</span>
        {isDismissible ? (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <span className="flex-shrink-0 text-[9px] opacity-70">{statusLabel(chat.status)}</span>
        )}
      </button>
    </li>
  );
}

const AppSidebar = forwardRef<SidebarHandle>(function AppSidebar(_props, ref) {
  const { user, logout, isDesktop, tunnelUrl } = useAuth();
  const { updateAvailable } = useDesktopUpdate();
  const { setOpenMobile, openMobile, isMobile, sidebarWidth } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { openDrawer } = useNewProjectDrawer();
  const activeChats = useGlobalActiveChats();
  const { setProject } = useProject();

  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);

  // Context menu and delete confirmation state for sidebar chat long-press
  const [sidebarCtx, setSidebarCtx] = useState<{ chat: ActiveChat; projectId: string; projectPath: string; x: number; y: number; trigger: 'longpress' | 'hover' } | null>(null);
  const [sidebarDeleteTarget, setSidebarDeleteTarget] = useState<{ chat: ActiveChat; projectId: string } | null>(null);
  const sidebarLongPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ideMenu, setIdeMenu] = useState<{ projectPath: string; x: number; y: number } | null>(null);
  const hoverShowRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close popover when mobile sidebar closes
  useEffect(() => {
    if (isMobile && !openMobile) setSidebarCtx(null);
  }, [openMobile, isMobile]);

  const [isChatDragActive, setIsChatDragActive] = useState(false);

  // MouseSensor + TouchSensor split: mouse drag on desktop, long-press drag on
  // mobile. PointerSensor would swallow quick finger swipes and block the
  // global edge-swipe gesture that opens this sidebar.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleChatDragEnd(projectId: string, chats: ActiveChat[], e: DragEndEvent) {
    setIsChatDragActive(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = chats.map(c => c.chatId);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = [...ids];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    const prevId = newIndex > 0 ? reordered[newIndex - 1] : null;
    const nextId = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
    api.put(`/api/projects/${projectId}/chats/${moved}/order`, { prevId, nextId }).catch(() => {});
  }

  function toggleChatFavorite(projectId: string, chatId: string, next: boolean) {
    api.put(`/api/projects/${projectId}/chats/${chatId}/favorite`, { favorite: next }).catch(() => {});
  }

  // Cleanup hover timers
  useEffect(() => () => {
    if (hoverShowRef.current) clearTimeout(hoverShowRef.current);
    if (hoverHideRef.current) clearTimeout(hoverHideRef.current);
  }, []);

  function handleSidebarChatTouchStart(e: ReactTouchEvent, chat: ActiveChat, projectId: string, projectPath: string) {
    const touch = e.touches[0];
    sidebarLongPress.current = setTimeout(() => {
      haptics.impactLight();
      setSidebarCtx({ chat, projectId, projectPath, x: touch.clientX, y: touch.clientY, trigger: 'longpress' });
    }, 500);
  }
  function handleSidebarChatTouchEndCancel() {
    if (sidebarLongPress.current) {
      clearTimeout(sidebarLongPress.current);
      sidebarLongPress.current = null;
    }
  }

  // Desktop: hover to show popover
  function handleChatMouseEnter(e: React.MouseEvent, chat: ActiveChat, projectId: string, projectPath: string) {
    if (isMobile || ideMenu) return;
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverShowRef.current = setTimeout(() => {
      setSidebarCtx({ chat, projectId, projectPath, x: rect.right + 4, y: rect.top, trigger: 'hover' });
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

  // Desktop app: right-click to open in IDE/Finder
  function handleChatContextMenu(e: React.MouseEvent, projectPath: string) {
    if (!isDesktop || isMobile) return;
    e.preventDefault();
    setSidebarCtx(null);
    if (hoverShowRef.current) { clearTimeout(hoverShowRef.current); hoverShowRef.current = null; }
    if (hoverHideRef.current) { clearTimeout(hoverHideRef.current); hoverHideRef.current = null; }
    setIdeMenu({ projectPath, x: e.clientX, y: e.clientY });
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

  // Track which project accordions are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((projectId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const accountSettingsUrl = tunnelUrl
    ? new URL('/settings', tunnelUrl).href
    : '/settings';

  function openAccountSettings(e: React.MouseEvent) {
    if (isDesktop && tunnelUrl) {
      e.preventDefault();
      api.post('/api/open-external', { url: accountSettingsUrl }).catch(() => {});
    }
  }

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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

  // Auto-close mobile drawer on navigation + clear search + close popover
  useEffect(() => {
    setOpenMobile(false);
    setSidebarSearch('');
    setSearchResults(null);
    setAccountPopoverOpen(false);
  }, [location.pathname]);

  // Close popover when mobile sidebar is dismissed
  useEffect(() => {
    if (!openMobile) setAccountPopoverOpen(false);
  }, [openMobile]);

  async function loadInitial() {
    try {
      const data = await api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=${PAGE_SIZE}&offset=0`);
      const fetched = data.projects || [];
      setProjects(fetched);
      offsetRef.current = fetched.length;
      setHasMore(fetched.length < (data.total || 0));
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
      const data = await api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=${PAGE_SIZE}&offset=${currentOffset}`);
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

  // Local filtering of already-loaded projects
  const localFiltered = useMemo(() => {
    if (!sidebarSearch.trim()) return null;
    const q = sidebarSearch.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(q));
  }, [sidebarSearch, projects]);

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

  // Display: API results when available, else local filter, else full list
  // Sort projects with active chats to the top
  const baseProjects = searchResults ?? localFiltered ?? projects;
  const displayProjects = useMemo(() => {
    return [...baseProjects].sort((a, b) => {
      const aCount = activeChats.byProject[a.id]?.count || 0;
      const bCount = activeChats.byProject[b.id]?.count || 0;
      if (aCount > 0 && bCount === 0) return -1;
      if (aCount === 0 && bCount > 0) return 1;
      return 0;
    });
  }, [baseProjects, activeChats]);
  const showInfiniteScroll = !sidebarSearch.trim();

  // Auto-expand projects that have active chats
  useEffect(() => {
    const activeProjectIds = Object.keys(activeChats.byProject).filter(
      id => activeChats.byProject[id].count > 0
    );
    if (activeProjectIds.length > 0) {
      setExpanded(prev => {
        const next = new Set(prev);
        for (const id of activeProjectIds) next.add(id);
        return next;
      });
    }
  }, [activeChats]);

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
        {/* All Projects link */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/'} className="text-base h-10 md:text-sm md:h-8">
                <NavLink to="/" end className="flex items-center gap-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                  <span>All Projects</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/my-computer'} className="text-base h-10 md:text-sm md:h-8">
                <NavLink to="/my-computer" className="flex items-center gap-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
                  </svg>
                  <span>My Computer</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Projects list */}
        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-text-dim">Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <PullToRefresh onRefresh={loadInitial} disabled={isChatDragActive}>
            {/* Search input */}
            <div className="px-2 pb-2 relative">
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => handleSidebarSearch(e.target.value)}
                placeholder="Search projects..."
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
            <SidebarMenu>
              {searchLoading && sidebarSearch.trim() && (
                <li className="flex justify-center py-2">
                  <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                </li>
              )}
              {displayProjects.map((project) => {
                const projectActive = activeChats.byProject[project.id];
                const count = projectActive?.count || 0;
                const isExpanded = expanded.has(project.id);
                const isActive = location.pathname.startsWith(`/project/${project.id}`);

                return (
                  <SidebarMenuItem key={project.id}>
                    <div className="flex items-center w-full" onContextMenu={(e) => handleChatContextMenu(e, project.path)}>
                      {/* Expand/collapse toggle (only if has active chats) */}
                      {count > 0 ? (
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
                          <span className="w-2 h-2 rounded-full bg-border" />
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

                    {/* Expanded: active chats list */}
                    {count > 0 && isExpanded && (
                      <DndContext
                        sensors={dndSensors}
                        collisionDetection={closestCenter}
                        onDragStart={() => setIsChatDragActive(true)}
                        onDragCancel={() => setIsChatDragActive(false)}
                        onDragEnd={(e) => handleChatDragEnd(project.id, projectActive.chats, e)}
                      >
                        <SortableContext
                          items={projectActive.chats.map(c => c.chatId)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="ml-5 mt-0.5 mb-1 space-y-0.5">
                            {projectActive.chats.map((chat) => {
                              const isDismissible = chat.status === 'seen' || chat.status === 'new';
                              return (
                                <SortableChatRow
                                  key={chat.chatId}
                                  chat={chat}
                                  projectId={project.id}
                                  projectPath={project.path}
                                  isActive={location.pathname.includes(chat.chatId)}
                                  isDismissible={isDismissible}
                                  onSelect={() => {
                                    setOpenMobile(false);
                                    navigate(`/project/${project.id}/chats/${chat.chatId}`);
                                  }}
                                  onTouchStart={(e) => handleSidebarChatTouchStart(e, chat, project.id, project.path)}
                                  onTouchEndCancel={handleSidebarChatTouchEndCancel}
                                  onMouseEnter={(e) => handleChatMouseEnter(e, chat, project.id, project.path)}
                                  onMouseLeave={handleChatMouseLeave}
                                  onContextMenuNative={(e) => handleChatContextMenu(e, project.path)}
                                  onDismiss={() => {
                                    api.put(`/api/projects/${project.id}/chats/${chat.chatId}/dismiss`).catch(() => {});
                                  }}
                                />
                              );
                            })}
                          </ul>
                        </SortableContext>
                      </DndContext>
                    )}
                  </SidebarMenuItem>
                );
              })}

              {sidebarSearch.trim() && !searchLoading && displayProjects.length === 0 && (
                <li className="px-3 py-2 text-xs text-text-dim">No projects found</li>
              )}

              {/* Infinite scroll sentinel — only when not searching */}
              {showInfiniteScroll && <li><div ref={sentinelRef} /></li>}
              {showInfiniteScroll && loadingMore && (
                <li className="flex justify-center py-2">
                  <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                </li>
              )}

              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => { setOpenMobile(false); openDrawer(); }} className="text-text-muted text-lg h-12 md:text-sm md:h-8">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span>New Project</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            </PullToRefresh>
          </SidebarGroupContent>
        </SidebarGroup>

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
          {
            label: sidebarCtx.chat.favorite ? 'Unfavorite' : 'Set as favorite',
            icon: sidebarCtx.chat.favorite ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.32.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.32-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
            ) : (
              <svg className="w-4 h-4 text-warning" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.967a1 1 0 00.95.69h4.175c.969 0 1.371 1.24.588 1.81l-3.378 2.455a1 1 0 00-.364 1.118l1.287 3.966c.3.922-.755 1.688-1.54 1.118l-3.378-2.454a1 1 0 00-1.175 0l-3.378 2.454c-.784.57-1.838-.196-1.539-1.118l1.287-3.966a1 1 0 00-.364-1.118L2.05 9.394c-.783-.57-.38-1.81.588-1.81h4.175a1 1 0 00.95-.69l1.286-3.967z" /></svg>
            ),
            onAction: () => toggleChatFavorite(sidebarCtx.projectId, sidebarCtx.chat.chatId, !sidebarCtx.chat.favorite),
          },
          ...(sidebarCtx.chat.status === 'unread' ? [] : [{
            label: 'Set as unread',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>,
            onAction: () => {
              api.put(`/api/projects/${sidebarCtx.projectId}/chats/${sidebarCtx.chat.chatId}/unread`).catch(() => {});
            },
          }]),
          ...((sidebarCtx.chat.status === 'seen' || sidebarCtx.chat.status === 'new') ? [{
            label: 'Dismiss',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
            onAction: () => {
              api.put(`/api/projects/${sidebarCtx.projectId}/chats/${sidebarCtx.chat.chatId}/dismiss`).catch(() => {});
            },
          }] : []),
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
                  haptics.notificationError();
                  api.delete(`/api/projects/${sidebarDeleteTarget.projectId}/chats/${sidebarDeleteTarget.chat.chatId}`).catch(() => {});
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
