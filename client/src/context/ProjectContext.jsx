import { createContext, useContext, useState, useCallback } from 'react';
import api from '../utils/api.js';

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadProject = useCallback(async (projectId) => {
    setLoading(true);
    try {
      const data = await api.get(`/api/projects/${projectId}`);
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
        const data = await api.get(`/api/projects/${project.id}`);
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

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
