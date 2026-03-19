import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.ts';
import { Button } from '../components/ui/button.tsx';
import Header from '../components/layout/Header.tsx';
import { useSidebar } from '../components/ui/sidebar.tsx';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll.ts';
import ProjectCard from '../components/projects/ProjectCard.tsx';
import type { ProjectSummary } from '../../../shared/types/models.ts';

const PAGE_SIZE = 20;

export default function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();

  // On mobile: trap the back gesture on the root page to open sidebar
  useEffect(() => {
    if (window.innerWidth >= 768) return;

    // Push a sentinel state so the back gesture has something to pop
    window.history.pushState({ sidebarTrap: true }, '', window.location.href);

    function handlePopState() {
      // Re-push sentinel and open sidebar
      window.history.pushState({ sidebarTrap: true }, '', window.location.href);
      setOpenMobile(true);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setOpenMobile]);

  useEffect(() => {
    loadInitial();
  }, []);

  async function loadInitial() {
    try {
      const data = await api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=${PAGE_SIZE}&offset=0`);
      const fetched = data.projects || [];
      setProjects(fetched);
      offsetRef.current = fetched.length;
      setHasMore(fetched.length < (data.total || 0));
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Projects"
        actions={
          <Button onClick={() => navigate('/new')} className="text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Project
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-bg-surface rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-text mb-1">No projects yet</h3>
            <p className="text-text-muted mb-4">Create your first project to get started</p>
            <Button onClick={() => navigate('/new')}>
              Create Project
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} />
            {loadingMore && (
              <div className="flex justify-center py-4">
                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
