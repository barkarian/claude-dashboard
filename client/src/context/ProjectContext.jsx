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
      await loadProject(project.id);
    }
  }, [project?.id, loadProject]);

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
