import { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDesktopUpdate } from '../../context/DesktopUpdateContext.tsx';
import { Button } from '../ui/button.tsx';
import {
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
import SwipeableRow from '../ui/SwipeableRow.tsx';
import type { ProjectSummary } from '../../../../shared/types/models.ts';
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

const AppSidebar = forwardRef<SidebarHandle>(function AppSidebar(_props, ref) {
  const { user, logout, isDesktop, tunnelUrl } = useAuth();
  const { updateAvailable } = useDesktopUpdate();
  const { setOpenMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { openDrawer } = useNewProjectDrawer();
  const activeChats = useGlobalActiveChats();

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

  // Auto-close mobile drawer on navigation + clear search
  useEffect(() => {
    setOpenMobile(false);
    setSidebarSearch('');
    setSearchResults(null);
  }, [location.pathname]);

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
          <h1 className="text-lg font-bold text-text flex items-center gap-2">
            <span className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white text-sm font-bold">C</span>
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
              <SidebarMenuButton asChild isActive={location.pathname === '/'}>
                <NavLink to="/" end className="flex items-center gap-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                  <span>All Projects</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Projects list */}
        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-text-dim">Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <PullToRefresh onRefresh={loadInitial}>
            {/* Search input */}
            <div className="px-2 pb-2 relative">
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => handleSidebarSearch(e.target.value)}
                placeholder="Search projects..."
                className="w-full bg-bg-surface border border-border rounded-md px-2.5 py-1.5 pr-7 text-xs text-text placeholder:text-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
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
                    <div className="flex items-center w-full">
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
                      <SidebarMenuButton asChild isActive={isActive} className="flex-1 min-w-0">
                        <NavLink to={`/project/${project.id}`} className="flex items-center gap-2">
                          <span className="truncate">{project.name}</span>
                          {count > 0 && (
                            <span className={`ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${badgeClass(projectActive.chats)}`}>
                              {badgeCount(projectActive.chats) || count}
                            </span>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </div>

                    {/* Expanded: active chats list */}
                    {count > 0 && isExpanded && (
                      <ul className="ml-5 mt-0.5 mb-1 space-y-0.5">
                        {projectActive.chats.map((chat) => {
                          const isDismissible = chat.status === 'seen' || chat.status === 'new';
                          const chatRow = (
                            <button
                              onClick={() => {
                                setOpenMobile(false);
                                navigate(`/project/${project.id}/chats/${chat.chatId}`);
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors hover:bg-bg-hover ${
                                location.pathname.includes(chat.chatId) ? 'bg-bg-hover text-text' : 'text-text-dim'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(chat.status)}`} />
                              <span className="truncate flex-1 text-left">{chat.label}</span>
                              {isDismissible ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    api.put(`/api/projects/${project.id}/chats/${chat.chatId}/dismiss`).catch(() => {});
                                  }}
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
                          );

                          return (
                            <li key={chat.chatId}>
                              {isDismissible ? (
                                <SwipeableRow onDismiss={() => {
                                  api.put(`/api/projects/${project.id}/chats/${chat.chatId}/dismiss`).catch(() => {});
                                }}>
                                  {chatRow}
                                </SwipeableRow>
                              ) : chatRow}
                            </li>
                          );
                        })}
                      </ul>
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
                <SidebarMenuButton onClick={() => { setOpenMobile(false); openDrawer(); }} className="text-text-muted">
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

        {/* Settings */}
        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-text-dim">Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a
                    href={accountSettingsUrl}
                    onClick={openAccountSettings}
                    className="flex items-center gap-3"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Account Settings</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/settings'}>
                  <NavLink to="/settings" className="flex items-center gap-3">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.11v1.093c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Settings</span>
                    {updateAvailable && (
                      <span className="ml-auto flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        <span className="text-[10px] font-medium text-primary">Update</span>
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {user && (
          <div className="px-1 py-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
              <span className="text-xs font-medium text-text truncate">
                {user.username}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                user.plan === 'pro'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-border text-text-dim'
              }`}>
                {user.plan === 'pro' ? 'PRO' : 'FREE'}
              </span>
            </div>
            {user.plan !== 'pro' && (
              <a
                href={accountSettingsUrl}
                onClick={openAccountSettings}
                className="text-[11px] text-primary hover:underline mt-1 ml-4 block"
              >
                Upgrade to Pro &rarr;
              </a>
            )}
          </div>
        )}

        <div className="px-1">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-danger"
            onClick={logout}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {isDesktop ? 'Logout & Close Tunnel' : 'Logout'}
          </Button>
        </div>
      </SidebarFooter>

    </Sidebar>
  );
});

export default AppSidebar;
