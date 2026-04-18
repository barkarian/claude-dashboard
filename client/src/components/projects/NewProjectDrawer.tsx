import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import { useAppSidebar } from '../../context/SidebarContext.tsx';
import { Drawer, DrawerContent, DrawerTitle } from '../ui/drawer.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Alert } from '../ui/alert.tsx';
import RepoSelector from './RepoSelector.tsx';
import FolderBrowser from './FolderBrowser.tsx';
import TruncatedPath from '../ui/truncated-path.tsx';
import api from '../../utils/api.ts';
import { isTauriDesktop } from '../../utils/platform.ts';
import { pickDirectory } from '../../utils/nativeDialog.ts';
import type { GitHubRepo, Project, ChatAdapter } from '../../../../shared/types/models.ts';

type Tab = 'existing' | 'clone' | 'empty';

function toFolderName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

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

  // Empty tab state
  const [emptyFolderName, setEmptyFolderName] = useState('');
  const [emptyDirPath, setEmptyDirPath] = useState('');
  const [emptySelectedBrowserPath, setEmptySelectedBrowserPath] = useState('');
  const [emptyFolderNameEdited, setEmptyFolderNameEdited] = useState(false);

  // Adapter state
  // No UI toggle — adapter is chosen per-chat via New Chat picker.
  // Pass undefined so server uses its own default.
  const defaultAdapter: ChatAdapter | undefined = undefined;

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
    setEmptyFolderName('');
    setEmptyDirPath('');
    setEmptySelectedBrowserPath('');
    setEmptyFolderNameEdited(false);
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
    setEmptyFolderName('');
    setEmptyDirPath('');
    setEmptySelectedBrowserPath('');
    setEmptyFolderNameEdited(false);
    setError('');
    setCreatedProjectId(null);
    setSuccess(false);
  }

  const isDesktop = isTauriDesktop();

  // --- Existing tab ---
  function handleFolderSelect(path: string) {
    setSelectedPath(path);
    const folderName = path.split('/').filter(Boolean).pop() || '';
    setProjectName(folderName);
    setProjectPath(path);
  }

  async function handleNativePickFolder() {
    setError('');
    try {
      const path = await pickDirectory();
      if (path) handleFolderSelect(path);
    } catch (e: any) {
      setError(`Directory picker failed: ${e.message}`);
    }
  }

  async function handleNativePickEmptyDir() {
    setError('');
    try {
      const path = await pickDirectory();
      if (path) handleEmptyFolderSelect(path);
    } catch (e: any) {
      setError(`Directory picker failed: ${e.message}`);
    }
  }

  async function handleRegister() {
    if (!projectName.trim() || !projectPath.trim()) return;
    setCreating(true);
    setError('');
    try {
      const data = await api.post<{ project: Project }>('/api/projects/register', {
        name: projectName,
        path: projectPath,
        defaultAdapter,
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
        defaultAdapter,
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
  function handleEmptyFolderSelect(path: string) {
    setEmptyDirPath(path);
    setEmptySelectedBrowserPath(path);
  }

  async function handleCreateEmpty() {
    if (!projectName.trim() || !emptyFolderName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const fullPath = emptyDirPath
        ? `${emptyDirPath}/${emptyFolderName}`.replace('//', '/')
        : undefined;
      const data = await api.post<{ project: Project }>('/api/projects', {
        name: projectName,
        path: fullPath,
        repoUrl: null,
        defaultAdapter,
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
    <Drawer open={isOpen} onOpenChange={handleOpenChange}>
      <DrawerContent className="h-[80vh] flex flex-col">
        <div className="px-4 pb-4 flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <DrawerTitle className="text-lg font-semibold">New Project</DrawerTitle>
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
                    {isDesktop ? (
                      <div className="space-y-3">
                        <Button variant="outline" onClick={handleNativePickFolder} className="w-full">
                          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                          </svg>
                          {selectedPath ? 'Change Directory' : 'Select Directory'}
                        </Button>
                        {selectedPath && (
                          <TruncatedPath path={selectedPath} />
                        )}
                      </div>
                    ) : (
                      <FolderBrowser
                        onSelect={handleFolderSelect}
                        selectedPath={selectedPath}
                      />
                    )}

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
                        onChange={(e) => {
                          setProjectName(e.target.value);
                          if (!emptyFolderNameEdited) {
                            setEmptyFolderName(toFolderName(e.target.value));
                          }
                        }}
                        placeholder="My New Project"
                      />
                    </div>
                    <div>
                      <Label>Folder Name</Label>
                      <Input
                        type="text"
                        value={emptyFolderName}
                        onChange={(e) => {
                          setEmptyFolderName(e.target.value);
                          setEmptyFolderNameEdited(true);
                        }}
                        className="font-mono"
                        placeholder="my-new-project"
                      />
                    </div>
                    <div>
                      <Label className="mb-2 block">Parent Directory</Label>
                      {isDesktop ? (
                        <div className="space-y-3">
                          <Button variant="outline" onClick={handleNativePickEmptyDir} className="w-full">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                            </svg>
                            {emptyDirPath ? 'Change Directory' : 'Select Parent Directory'}
                          </Button>
                          {emptyDirPath && (
                            <TruncatedPath path={emptyDirPath} />
                          )}
                        </div>
                      ) : (
                        <FolderBrowser
                          onSelect={handleEmptyFolderSelect}
                          selectedPath={emptySelectedBrowserPath}
                        />
                      )}
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
                  <div className="space-y-1">
                    <Button
                      onClick={handleCreateEmpty}
                      className="w-full"
                      disabled={creating || !projectName.trim() || !emptyFolderName.trim()}
                    >
                      {creating ? (
                        <>
                          <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                          Creating...
                        </>
                      ) : 'Create Empty Project'}
                    </Button>
                    {emptyFolderName && (
                      <TruncatedPath
                        path={emptyDirPath ? `${emptyDirPath}/${emptyFolderName}` : `~/projects/${emptyFolderName}`}
                        className="justify-center"
                      />
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
