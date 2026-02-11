import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import api from '../utils/api.ts';
import type { Project } from '../../../shared/types/models.ts';

interface ProjectContextValue {
  project: Project | null;
  loading: boolean;
  loadProject: (projectId: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  const loadProject = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const data = await api.get<{ project: Project }>(`/api/projects/${projectId}`);
      setProject(data.project);
    } catch (err) {
      console.error('Error loading project:', err);
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProject = useCallback(async () => {
    if (project?.id) {
      // Refresh silently — do NOT set loading to true.
      // Setting loading=true causes ProjectDashboardPage to unmount all children
      // (including active ChatView sessions) and show a spinner.
      try {
        const data = await api.get<{ project: Project }>(`/api/projects/${project.id}`);
        setProject(data.project);
      } catch (err) {
        console.error('Error refreshing project:', err);
      }
    }
  }, [project?.id]);

  return (
    <ProjectContext.Provider value={{ project, loading, loadProject, refreshProject, setProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
