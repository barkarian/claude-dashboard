import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.ts';
import { Button } from '../components/ui/button.tsx';
import { useSidebar } from '../components/ui/sidebar.tsx';
import { useNewProjectDrawer } from '../context/NewProjectDrawerContext.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog.tsx';
import { Input } from '../components/ui/input.tsx';
import TruncatedPath from '../components/ui/truncated-path.tsx';
import type { ProjectSummary } from '../../../shared/types/models.ts';

const PAGE_SIZE = 20;

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { openDrawer } = useNewProjectDrawer();

  // Prompt state
  const [message, setMessage] = useState('');
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Command dialog state
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdProjects, setCmdProjects] = useState<ProjectSummary[]>([]);
  const [cmdSearch, setCmdSearch] = useState('');
  const [cmdLoading, setCmdLoading] = useState(false);
  const cmdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cmdInputRef = useRef<HTMLInputElement>(null);

  // Project list state (below section)
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const [listSearch, setListSearch] = useState('');
  const listSearchRef = useRef('');
  const listTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // On mobile: trap back gesture to open sidebar
  useEffect(() => {
    if (window.innerWidth >= 768) return;
    window.history.pushState({ sidebarTrap: true }, '', window.location.href);
    function handlePopState() {
      window.history.pushState({ sidebarTrap: true }, '', window.location.href);
      setOpenMobile(true);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setOpenMobile]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [message]);

  // Load initial projects for list + auto-select latest
  useEffect(() => {
    fetchListProjects('', 0, true);
  }, []);

  // --- Command dialog ---
  function openCmd() {
    setCmdOpen(true);
    setCmdSearch('');
    fetchCmdProjects('');
    setTimeout(() => cmdInputRef.current?.focus(), 100);
  }

  function fetchCmdProjects(q: string) {
    setCmdLoading(true);
    const searchParam = q ? `&search=${encodeURIComponent(q)}` : '';
    api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=20&offset=0${searchParam}`)
      .then((data) => setCmdProjects(data.projects || []))
      .catch(() => {})
      .finally(() => setCmdLoading(false));
  }

  function handleCmdSearchChange(value: string) {
    setCmdSearch(value);
    if (cmdTimerRef.current) clearTimeout(cmdTimerRef.current);
    cmdTimerRef.current = setTimeout(() => fetchCmdProjects(value), 300);
  }

  function handleCmdSelect(project: ProjectSummary) {
    setSelectedProject(project);
    setCmdOpen(false);
  }

  function handleCmdNewProject() {
    setCmdOpen(false);
    openDrawer();
  }

  // --- List search (below section) ---
  function fetchListProjects(q: string, offset: number, reset: boolean) {
    if (reset) setListLoading(true);
    const searchParam = q ? `&search=${encodeURIComponent(q)}` : '';
    api.get<{ projects: ProjectSummary[]; total: number }>(`/api/projects?limit=${PAGE_SIZE}&offset=${offset}${searchParam}`)
      .then((data) => {
        const fetched = data.projects || [];
        if (reset) {
          setProjects(fetched);
          // Auto-select latest on initial load
          if (!q && fetched.length > 0 && !selectedProject) {
            setSelectedProject(fetched[0]);
          }
        } else {
          setProjects(prev => [...prev, ...fetched]);
        }
        const newOffset = (reset ? 0 : offset) + fetched.length;
        offsetRef.current = newOffset;
        setHasMore(newOffset < (data.total || 0));
      })
      .catch(() => {})
      .finally(() => { setListLoading(false); setLoadingMore(false); });
  }

  function handleListSearchChange(value: string) {
    setListSearch(value);
    listSearchRef.current = value;
    if (listTimerRef.current) clearTimeout(listTimerRef.current);
    listTimerRef.current = setTimeout(() => fetchListProjects(value, 0, true), 300);
  }

  // Infinite scroll — refs to avoid stale closures
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  loadingMoreRef.current = loadingMore;
  hasMoreRef.current = hasMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMoreRef.current && !loadingMoreRef.current) {
          setLoadingMore(true);
          loadingMoreRef.current = true;
          fetchListProjects(listSearchRef.current, offsetRef.current, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [projects]);

  // --- Prompt handlers ---
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSend() {
    if (!message.trim() || !selectedProject || sending) return;
    setSending(true);
    try {
      const data = await api.post<{ chat: { id: string } }>(`/api/projects/${selectedProject.id}/chats`, {
        label: message.trim().slice(0, 60),
      });
      navigate(`/project/${selectedProject.id}/chats/${data.chat.id}`, {
        state: { prefillContent: message.trim(), autoSend: true },
      });
    } catch (err) {
      console.error('Failed to create chat:', err);
      setSending(false);
    }
  }

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
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto w-full px-4 py-6">
          {/* ===== PROMPT BOX ===== */}
          <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent px-4 pt-3 pb-2 text-text placeholder-text-dim focus:outline-none resize-none min-h-[80px] max-h-[200px]"
              placeholder="What do you want to build?"
              rows={3}
            />

            {/* Bottom bar: project picker button + send */}
            <div className="border-t border-border px-3 py-2 flex items-center gap-2">
              <button
                onClick={openCmd}
                className="flex items-center gap-1.5 text-xs bg-bg rounded-md px-2 py-1.5 border border-border hover:border-primary/50 transition-colors min-w-0 flex-1"
              >
                <svg className="w-3.5 h-3.5 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                <span className="text-text truncate">
                  {selectedProject ? selectedProject.name : 'Select project...'}
                </span>
                <svg className="w-3 h-3 text-text-dim flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
                </svg>
              </button>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-text-dim hidden sm:inline">Cmd+Enter</span>
                <Button
                  onClick={handleSend}
                  disabled={!message.trim() || !selectedProject || sending}
                  className="h-7 px-3 text-xs gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                  Send
                </Button>
              </div>
            </div>
          </div>

          {/* ===== PROJECT PICKER DIALOG ===== */}
          <Dialog open={cmdOpen} onOpenChange={(open) => !open && setCmdOpen(false)}>
            <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Select Project</DialogTitle>
              </DialogHeader>

              <div className="mb-3">
                <Input
                  ref={cmdInputRef}
                  type="text"
                  value={cmdSearch}
                  onChange={(e) => handleCmdSearchChange(e.target.value)}
                  className="text-sm py-1.5"
                  placeholder="Search projects..."
                />
              </div>

              <div className="overflow-y-auto flex-1 -mx-6 px-6">
                {/* + New Project — always first */}
                <button
                  onClick={handleCmdNewProject}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2 mb-1"
                >
                  <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span className="text-sm font-medium text-primary">New Project</span>
                </button>

                {cmdLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : cmdProjects.length === 0 ? (
                  <div className="py-4 text-sm text-text-muted text-center">No projects found</div>
                ) : (
                  cmdProjects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => handleCmdSelect(project)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text truncate">{project.name}</div>
                        {project.path && (
                          <TruncatedPath path={project.path} />
                        )}
                      </div>
                      {selectedProject?.id === project.id && (
                        <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* ===== SEPARATOR ===== */}
          <div className="my-6 border-t border-border" />

          {/* ===== PROJECT SEARCH + LIST ===== */}
          <div className="space-y-3">
            <input
              type="text"
              value={listSearch}
              onChange={(e) => handleListSearchChange(e.target.value)}
              placeholder="Search projects..."
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />

            <Button variant="outline" onClick={openDrawer} className="w-full gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Project
            </Button>

            {listLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-text-muted text-sm">
                  {listSearch ? 'No projects match your search' : 'No projects yet'}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => navigate(`/project/${project.id}`)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-surface transition-colors flex items-center gap-3"
                  >
                    <span className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text truncate">{project.name}</div>
                      {project.path && (
                        <TruncatedPath path={project.path} />
                      )}
                    </div>
                  </button>
                ))}

                <div ref={sentinelRef} />
                {loadingMore && (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
