import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import { useAppSidebar } from '../../context/SidebarContext.tsx';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Alert } from '../ui/alert.tsx';
import RepoSelector from './RepoSelector.tsx';
import FolderBrowser from './FolderBrowser.tsx';
import TruncatedPath from '../ui/truncated-path.tsx';
import api from '../../utils/api.ts';
import type { GitHubRepo, Project } from '../../../../shared/types/models.ts';

type Tab = 'existing' | 'clone' | 'empty';

export default function NewProjectDrawer() {
  const { isOpen, closeDrawer } = useNewProjectDrawer();
  const { refreshProjects } = useAppSidebar();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('existing');

  // Existing tab state
  const [selectedPath, setSelectedPath] = useState('');

  // Clone tab state
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [customUrl, setCustomUrl] = useState('');

  // Shared state
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setTab('existing');
    setSelectedPath('');
    setSelectedRepo(null);
    setCustomUrl('');
    setProjectName('');
    setProjectPath('');
    setCreating(false);
    setError('');
    setCreatedProjectId(null);
    setSuccess(false);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      closeDrawer();
      setTimeout(reset, 300);
    }
  }

  function handleTabChange(newTab: Tab) {
    setTab(newTab);
    setSelectedPath('');
    setSelectedRepo(null);
    setCustomUrl('');
    setProjectName('');
    setProjectPath('');
    setError('');
    setCreatedProjectId(null);
    setSuccess(false);
  }

  // --- Existing tab ---
  function handleFolderSelect(path: string) {
    setSelectedPath(path);
    const folderName = path.split('/').filter(Boolean).pop() || '';
    setProjectName(folderName);
    setProjectPath(path);
  }

  async function handleRegister() {
    if (!projectName.trim() || !projectPath.trim()) return;
    setCreating(true);
    setError('');
    try {
      const data = await api.post<{ project: Project }>('/api/projects/register', {
        name: projectName,
        path: projectPath,
      });
      setCreatedProjectId(data.project.id);
      setSuccess(true);
      refreshProjects();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // --- Clone tab ---
  function handleRepoSelect(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setProjectName(repo.name);
  }

  async function handleClone() {
    const repoUrl = selectedRepo?.url || customUrl.trim();
    if (!repoUrl || !projectName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const data = await api.post<{ project: Project }>('/api/projects', {
        name: projectName,
        path: projectPath || undefined,
        repoUrl,
      });
      setCreatedProjectId(data.project.id);
      setSuccess(true);
      refreshProjects();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // --- Empty tab ---
  async function handleCreateEmpty() {
    if (!projectName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const data = await api.post<{ project: Project }>('/api/projects', {
        name: projectName,
        path: projectPath || undefined,
        repoUrl: null,
      });
      setCreatedProjectId(data.project.id);
      setSuccess(true);
      refreshProjects();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleOpenProject() {
    if (!createdProjectId) return;
    closeDrawer();
    setTimeout(reset, 300);
    navigate(`/project/${createdProjectId}`);
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="h-[60vh] rounded-t-2xl flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-12 h-1.5 rounded-full bg-border" />
        </div>

        <div className="px-4 pb-4 flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <SheetTitle className="text-lg font-semibold">New Project</SheetTitle>
          </div>

          {/* Success state */}
          {success && createdProjectId ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4">
              <Alert variant="success">Project {tab === 'existing' ? 'added' : 'created'} successfully!</Alert>
              <Button onClick={handleOpenProject} className="w-full">
                Open Project
              </Button>
            </div>
          ) : (
            <>
              {/* Tab toggle */}
              <div className="flex gap-1 p-1 bg-bg rounded-lg mb-4 flex-shrink-0">
                <button
                  onClick={() => handleTabChange('existing')}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${tab === 'existing' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}
                >
                  Existing
                </button>
                <button
                  onClick={() => handleTabChange('clone')}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${tab === 'clone' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}
                >
                  Clone Repo
                </button>
                <button
                  onClick={() => handleTabChange('empty')}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${tab === 'empty' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}
                >
                  Create Empty
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* --- Existing tab --- */}
                {tab === 'existing' && (
                  <div className="space-y-4">
                    <FolderBrowser
                      onSelect={handleFolderSelect}
                      selectedPath={selectedPath}
                    />

                    {selectedPath && (
                      <div className="space-y-3 pt-2 border-t border-border">
                        <div>
                          <Label>Project Name</Label>
                          <Input
                            type="text"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* --- Clone Repo tab --- */}
                {tab === 'clone' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium mb-2">Select a Repository</h3>
                      <RepoSelector onSelect={handleRepoSelect} />
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-bg-surface text-text-muted">or paste a URL</span>
                      </div>
                    </div>

                    <div>
                      <Input
                        type="text"
                        value={customUrl}
                        onChange={(e) => {
                          setCustomUrl(e.target.value);
                          setSelectedRepo(null);
                          const name = e.target.value.split('/').pop()?.replace('.git', '') ?? '';
                          if (name) setProjectName(name);
                        }}
                        placeholder="https://github.com/user/repo.git"
                      />
                    </div>

                    {(selectedRepo || customUrl.trim()) && (
                      <div className="space-y-3 pt-2 border-t border-border">
                        <div>
                          <Label>Project Name</Label>
                          <Input
                            type="text"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label>Directory Path (optional)</Label>
                          <Input
                            type="text"
                            value={projectPath}
                            onChange={(e) => setProjectPath(e.target.value)}
                            className="font-mono"
                            placeholder="Leave empty for default ~/projects/"
                          />
                        </div>
                        {selectedRepo?.url && (
                          <TruncatedPath path={selectedRepo.url} prefix="Repo" />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* --- Create Empty tab --- */}
                {tab === 'empty' && (
                  <div className="space-y-4">
                    <div>
                      <Label>Project Name</Label>
                      <Input
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="my-project"
                      />
                    </div>
                    <div>
                      <Label>Directory Path (optional)</Label>
                      <Input
                        type="text"
                        value={projectPath}
                        onChange={(e) => setProjectPath(e.target.value)}
                        className="font-mono"
                        placeholder="Leave empty for default ~/projects/"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex-shrink-0 pt-3">
                  <Alert variant="danger">{error}</Alert>
                </div>
              )}

              {/* Sticky bottom action button */}
              <div className="flex-shrink-0 pt-3 border-t border-border mt-3">
                {tab === 'existing' && (
                  <div className="space-y-1">
                    <Button
                      onClick={handleRegister}
                      className="w-full"
                      disabled={creating || !selectedPath || !projectName.trim()}
                    >
                      {creating ? (
                        <>
                          <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                          Adding...
                        </>
                      ) : 'Add Project'}
                    </Button>
                    {selectedPath && (
                      <TruncatedPath path={selectedPath} className="justify-center" />
                    )}
                  </div>
                )}
                {tab === 'clone' && (
                  <Button
                    onClick={handleClone}
                    className="w-full"
                    disabled={creating || (!selectedRepo && !customUrl.trim()) || !projectName.trim()}
                  >
                    {creating ? (
                      <>
                        <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Cloning...
                      </>
                    ) : 'Clone & Create Project'}
                  </Button>
                )}
                {tab === 'empty' && (
                  <Button
                    onClick={handleCreateEmpty}
                    className="w-full"
                    disabled={creating || !projectName.trim()}
                  >
                    {creating ? (
                      <>
                        <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Creating...
                      </>
                    ) : 'Create Empty Project'}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
