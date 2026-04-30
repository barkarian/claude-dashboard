import { useState, useEffect, useRef } from 'react';
import Fuse from 'fuse.js';
import { Input } from '../ui/input.tsx';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import api from '../../utils/api.ts';
import type { ProjectSummary } from '../../../../shared/types/models.ts';

interface ProjectSelectorProps {
  onSelect: (project: ProjectSummary) => void;
}

export default function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const { openDrawer } = useNewProjectDrawer();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [results, setResults] = useState<ProjectSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const fuseRef = useRef<Fuse<ProjectSummary> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    // Focus search input when mounted
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  async function loadProjects() {
    try {
      const data = await api.get<{ projects: ProjectSummary[]; total: number }>('/api/projects?limit=100&offset=0');
      const fetched = data.projects || [];
      setProjects(fetched);
      setResults(fetched);
      fuseRef.current = new Fuse(fetched, {
        keys: ['name', 'path'],
        threshold: 0.4,
        distance: 100,
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(value: string) {
    setSearch(value);
    if (!value.trim()) {
      setResults(projects);
      return;
    }
    if (fuseRef.current) {
      const matches = fuseRef.current.search(value).slice(0, 20);
      setResults(matches.map(m => m.item));
    }
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="text-sm font-medium text-text-muted">Select a workspace</div>

      <Input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search workspaces..."
      />

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {/* New Project option */}
          <button
            onClick={openDrawer}
            className="w-full text-left px-3 py-2.5 hover:bg-bg-hover transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="text-primary font-medium">New Project</span>
          </button>

          {results.length === 0 ? (
            <div className="text-center py-4 text-text-muted text-sm">No projects found</div>
          ) : (
            results.map((project) => (
              <button
                key={project.id}
                onClick={() => onSelect(project)}
                className="w-full text-left px-3 py-2.5 hover:bg-bg-hover transition-colors text-sm"
              >
                <div className="font-medium text-text truncate">{project.name}</div>
                {project.path && (
                  <div className="text-xs text-text-dim font-mono truncate mt-0.5">{project.path}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
