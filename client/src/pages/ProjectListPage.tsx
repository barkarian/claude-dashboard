import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.ts';
import { Button } from '../components/ui/button.tsx';
import { useSidebar } from '../components/ui/sidebar.tsx';
import { useNewProjectDrawer } from '../context/NewProjectDrawerContext.tsx';
import MobileSearchSheet from '../components/ui/MobileSearchSheet.tsx';
import ProjectCard from '../components/projects/ProjectCard.tsx';
import PullToRefresh from '../components/ui/PullToRefresh.tsx';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll.ts';
import { useIsMobile } from '../hooks/use-mobile.tsx';
import { useGlobalActiveChats } from '../hooks/useGlobalActiveChats.ts';
import type { ProjectSummary } from '../../../shared/types/models.ts';

const PAGE_SIZE = 5;

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { openDrawer } = useNewProjectDrawer();
  const isMobile = useIsMobile();
  const globalActive = useGlobalActiveChats();

  // Active sessions bubble: count all open sessions, color by thinking state
  const { sessionCount, sessionBubbleColor } = useMemo(() => {
    const allChats = Object.values(globalActive.byProject).flatMap(p => p.chats);
    const count = allChats.length;
    const hasThinking = allChats.some(c => c.status === 'working');
    const color = hasThinking ? 'bg-[#eab308]' : 'bg-success';
    return { sessionCount: count, sessionBubbleColor: color };
  }, [globalActive]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Paginated state
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [total, setTotal] = useState(0);
  const offsetRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // On mobile: trap back gesture so it does nothing on the root page
  useEffect(() => {
    if (window.innerWidth >= 768) return;
    setOpenMobile(false);
    window.history.pushState({ sidebarTrap: true }, '', window.location.href);
    function handlePopState() {
      window.history.pushState({ sidebarTrap: true }, '', window.location.href);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setOpenMobile]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch projects on mount and search change
  useEffect(() => {
    loadProjects(true);
  }, [debouncedSearch]);

  async function loadProjects(reset: boolean) {
    const currentOffset = reset ? 0 : offsetRef.current;
    if (!reset) setLoadingMore(true);
    if (reset) {
      setInitialLoading(true);
      setHasMore(false);
    }

    try {
      const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '';
      const data = await api.get<{ projects: ProjectSummary[]; total: number }>(
        `/api/projects?limit=${PAGE_SIZE}&offset=${currentOffset}${searchParam}`
      );
      const newProjects = data.projects || [];
      if (reset) {
        setProjects(newProjects);
      } else {
        setProjects(prev => [...prev, ...newProjects]);
      }
      const newOffset = currentOffset + newProjects.length;
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
      loadProjects(false);
    }
  }, [loadingMore, hasMore, debouncedSearch]);

  const { sentinelRef } = useInfiniteScroll({ loadMore, hasMore, loading: loadingMore });

  const showSearch = projects.length > 0 || searchQuery;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
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
            <h2
              className="text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Claw Dev
            </h2>
            {sessionCount > 0 && (
              <span className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${sessionBubbleColor} text-white`}>
                {sessionCount}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <PullToRefresh onRefresh={() => loadProjects(true)} className="max-w-xl mx-auto w-full px-4 py-4 space-y-3">
          {/* New Project button */}
          <Button onClick={openDrawer} variant="outline" className="w-full">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Project
          </Button>

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
                placeholder="Search projects..."
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
            title="Search Projects"
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search projects..."
            loading={initialLoading}
            emptyContent={
              projects.length === 0 && searchQuery
                ? <div className="py-4 text-sm text-text-muted text-center">No matching projects</div>
                : projects.length === 0
                  ? <div className="py-4 text-sm text-text-muted text-center">No projects yet</div>
                  : undefined
            }
          >
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setSheetOpen(false);
                  navigate(`/project/${project.id}`);
                }}
                className="w-full text-left px-3 py-2.5 rounded-lg active:bg-bg-hover transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text truncate">{project.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {project.chatsCount || 0} chats · {project.scriptsCount || 0} scripts
                  </div>
                </div>
                <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ))}
          </MobileSearchSheet>

          {/* Project list */}
          {initialLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : projects.length === 0 && !searchQuery ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <h3 className="text-text font-medium mb-1">No projects yet</h3>
              <p className="text-text-muted text-sm mb-4">Create your first project to get started</p>
            </div>
          ) : projects.length === 0 && searchQuery ? (
            <div className="text-center py-8">
              <p className="text-text-muted text-sm">No matching projects</p>
            </div>
          ) : (
            <>
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
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
        </PullToRefresh>
      </div>
    </div>
  );
}
