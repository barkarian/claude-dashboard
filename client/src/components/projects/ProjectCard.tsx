import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/card.tsx';
import type { ProjectSummary } from '../../../../shared/types/models.ts';

interface ProjectCardProps {
  project: ProjectSummary;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const navigate = useNavigate();
  const hasRunning = false; // Will be enhanced with real-time status later

  return (
    <Card
      onClick={() => navigate(`/project/${project.id}`)}
      className="text-left w-full hover:border-border-light transition-all group cursor-pointer"
      role="button"
      tabIndex={0}
    >
      <div className="flex gap-3">
        <div className={`w-1 rounded-full self-stretch flex-shrink-0 ${hasRunning ? 'bg-success' : 'bg-border'}`} />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text group-hover:text-primary transition-colors truncate">
            {project.name}
          </h3>
          <p className="text-xs text-text-dim font-mono mt-0.5 truncate">{project.path}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
            <span>{project.scriptsCount || 0} scripts</span>
            <span className="text-border">·</span>
            <span>{project.chatsCount || 0} chats</span>
          </div>
        </div>
        <svg className="w-5 h-5 text-text-dim group-hover:text-text-muted transition-colors flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </Card>
  );
}
