import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../ui/alert-dialog.tsx';
import { Button } from '../ui/button.tsx';
import FolderBrowser from './FolderBrowser.tsx';
import api from '../../utils/api.ts';
import { useAppSidebar } from '../../context/SidebarContext.tsx';

interface ProjectPathErrorProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  onPathChanged: () => void;
  onDeleted: () => void;
}

export default function ProjectPathError({
  projectId,
  projectName,
  projectPath,
  onPathChanged,
  onDeleted,
}: ProjectPathErrorProps) {
  const navigate = useNavigate();
  const { refreshProjects } = useAppSidebar();
  const [view, setView] = useState<'error' | 'remap'>('error');
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSavePath() {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await api.patch(`/api/projects/${projectId}`, { path: selectedPath });
      toast.success('Project path updated');
      refreshProjects();
      onPathChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update path');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProject() {
    setDeleting(true);
    try {
      await api.delete(`/api/projects/${projectId}`, { deleteFolder: false });
      toast.success(`Project "${projectName}" deleted`);
      refreshProjects();
      onDeleted();
      navigate('/');
    } catch {
      toast.error('Failed to delete project');
    } finally {
      setDeleting(false);
    }
  }

  if (view === 'remap') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden px-4 py-6">
        <div className="mb-4">
          <button
            onClick={() => setView('error')}
            className="text-sm text-text-muted hover:text-text flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>
        </div>

        <h3 className="text-base font-medium text-text mb-1">Choose a new directory</h3>
        <p className="text-sm text-text-muted mb-4">
          Select the directory where this project now lives.
        </p>

        <div className="flex-1 overflow-y-auto">
          <FolderBrowser onSelect={setSelectedPath} selectedPath={selectedPath} />
        </div>

        <div className="pt-4 border-t border-border mt-4">
          <Button
            onClick={handleSavePath}
            disabled={!selectedPath || saving}
            className="w-full"
          >
            {saving ? 'Saving...' : 'Use this directory'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          {/* Warning icon */}
          <div className="mx-auto w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>

          <h3 className="text-lg font-medium text-text mb-2">Directory not found</h3>
          <p className="text-sm text-text-muted mb-3">
            Sorry, there is no directory at this path (you may have moved the directory).
          </p>

          <div className="bg-bg-surface border border-border rounded-lg px-3 py-2 mb-6">
            <p className="text-xs text-text-dim font-mono break-all">{projectPath}</p>
          </div>

          <div className="flex flex-col gap-3">
            <Button onClick={() => setView('remap')} className="w-full">
              Change Path
            </Button>
            <Button
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full"
            >
              Delete Project
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong className="text-text">"{projectName}"</strong>? This will remove all chats and scripts associated with this project. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteProject(); }}
              disabled={deleting}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
