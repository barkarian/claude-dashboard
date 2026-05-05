import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api.ts';
import MobileSearchSheet from '../ui/MobileSearchSheet.tsx';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import type { ProjectSummary } from '../../../../shared/types/models.ts';

interface WorkspaceSwitcherProps {
  currentProjectId: string;
}

/**
 * Chevron-down trigger sitting beside the project name in the header.
 * Opens a search sheet listing all workspaces; first row creates a new one
 * via the existing NewProjectDrawer flow.
 */
export default function WorkspaceSwitcher({ currentProjectId }: WorkspaceSwitcherProps) {
  const navigate = useNavigate();
  const { openDrawer } = useNewProjectDrawer();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  // Fetch workspaces on open. List is small (capped at 50) so re-fetching
  // on every open is fine and keeps the data fresh after creates/deletes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api.get<{ projects: ProjectSummary[]; total: number }>('/api/projects?limit=50&offset=0')
      .then(d => { if (!cancelled) setWorkspaces(d.projects || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(w =>
      w.name.toLowerCase().includes(q) || w.path.toLowerCase().includes(q),
    );
  }, [workspaces, query]);

  function handleSelect(projectId: string) {
    setOpen(false);
    if (projectId !== currentProjectId) {
      navigate(`/project/${projectId}`);
    }
  }

  function handleCreate() {
    setOpen(false);
    openDrawer();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Switch workspace"
        title="Switch workspace"
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <MobileSearchSheet
        open={open}
        onOpenChange={setOpen}
        title="Switch Workspace"
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search workspaces..."
        loading={loading}
      >
        <div className="space-y-0.5">
          {/* Create row — pinned at the top of the list */}
          <button
            onClick={handleCreate}
            className="w-full text-left px-3 py-2.5 rounded-lg active:bg-bg-hover transition-colors flex items-center gap-2.5"
          >
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </span>
            <span className="text-sm font-medium text-primary">Create workspace</span>
          </button>

          {filtered.length === 0 && !loading && (
            <div className="py-4 text-sm text-text-muted text-center">
              {query ? 'No matching workspaces' : 'No workspaces yet'}
            </div>
          )}

          {filtered.map(ws => {
            const isCurrent = ws.id === currentProjectId;
            return (
              <button
                key={ws.id}
                onClick={() => handleSelect(ws.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg active:bg-bg-hover transition-colors flex items-center gap-2.5 ${
                  isCurrent ? 'bg-primary/5' : ''
                }`}
              >
                <svg
                  className={`flex-shrink-0 w-4 h-4 ${isCurrent ? 'text-primary' : 'text-text-dim'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm truncate ${isCurrent ? 'text-primary font-medium' : 'text-text'}`}>
                      {ws.name}
                    </span>
                    {isCurrent && (
                      <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted font-mono truncate">{ws.path}</div>
                </div>
                {!isCurrent && (
                  <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </MobileSearchSheet>
    </>
  );
}
