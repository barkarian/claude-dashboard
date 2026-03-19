import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.ts';
import { useSocket } from '../context/SocketContext.tsx';
import { useAppSidebar } from '../context/SidebarContext.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Alert } from '../components/ui/alert.tsx';
import Header from '../components/layout/Header.tsx';
import RepoSelector from '../components/projects/RepoSelector.tsx';
import SetupTerminal from '../components/projects/SetupTerminal.tsx';
import type { GitHubRepo, Project } from '../../../shared/types/models.ts';

export default function NewProjectPage() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { refreshProjects } = useAppSidebar();
  const [step, setStep] = useState(1);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [setupSessionId, setSetupSessionId] = useState<string | null>(null);
  const [setupDone, setSetupDone] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');

  function handleRepoSelect(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setProjectName(repo.name);
    setStep(2);
  }

  function handleCustomUrl() {
    if (!customUrl.trim()) return;
    const name = customUrl.split('/').pop()?.replace('.git', '') ?? '';
    setSelectedRepo({ name, url: customUrl.trim(), fullName: '', description: null, language: null, updatedAt: '', private: false });
    setProjectName(name);
    setStep(2);
  }

  async function handleCreate() {
    setCreating(true);
    setError('');
    try {
      const repoUrl = selectedRepo?.url || customUrl.trim() || null;
      const data = await api.post<{ project: Project; setupSessionId: string }>('/api/projects', {
        name: projectName,
        path: projectPath || undefined,
        repoUrl,
      });
      setSetupSessionId(data.setupSessionId);
      setCreatedProjectId(data.project.id);
      setSetupDone(true);
      refreshProjects();
    } catch (err: any) {
      setError(err.message);
      setCreating(false);
    }
  }

  async function handleRegister() {
    setCreating(true);
    setError('');
    try {
      const data = await api.post<{ project: Project }>('/api/projects/register', {
        name: projectName,
        path: projectPath,
      });
      setCreatedProjectId(data.project.id);
      setSetupDone(true);
      refreshProjects();
    } catch (err: any) {
      setError(err.message);
      setCreating(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="New Project" backTo="/" />

      <div className="flex-1 overflow-y-auto p-4 max-w-2xl mx-auto w-full">
        {step === 1 && (
          <div className="space-y-6">
            {/* Mode toggle */}
            <div className="flex gap-2 p-1 bg-bg-surface rounded-lg">
              <button
                onClick={() => setMode('new')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${mode === 'new' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}
              >
                Create New
              </button>
              <button
                onClick={() => setMode('existing')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${mode === 'existing' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}
              >
                Add Existing
              </button>
            </div>

            {mode === 'new' ? (
              <>
                <div>
                  <h3 className="text-lg font-medium mb-4">Select a Repository</h3>
                  <RepoSelector onSelect={handleRepoSelect} />
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-bg text-text-muted">or</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium mb-2">Clone from URL</h3>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      className="flex-1"
                      placeholder="https://github.com/user/repo.git"
                    />
                    <Button onClick={handleCustomUrl} disabled={!customUrl.trim()} className="whitespace-nowrap">
                      Clone
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-bg text-text-muted">or</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium mb-2">Empty Project</h3>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="flex-1"
                      placeholder="project-name"
                    />
                    <Button
                      variant="outline"
                      onClick={() => { setSelectedRepo(null); setStep(2); }}
                      disabled={!projectName.trim()}
                      className="whitespace-nowrap"
                    >
                      Create Empty
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">
                  Register an existing directory on your filesystem as a project.
                </p>
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
                  <Label>Directory Path</Label>
                  <Input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    className="font-mono"
                    placeholder="/Users/you/projects/my-project"
                  />
                </div>
                {error && (
                  <Alert variant="danger">{error}</Alert>
                )}
                {!setupDone ? (
                  <Button
                    onClick={handleRegister}
                    className="w-full"
                    disabled={creating || !projectName.trim() || !projectPath.trim()}
                  >
                    {creating ? (
                      <>
                        <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Adding...
                      </>
                    ) : 'Add Project'}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <Alert variant="success">
                      Project added successfully!
                    </Alert>
                    <Button
                      onClick={() => navigate(`/project/${createdProjectId}`)}
                      className="w-full"
                    >
                      Open Project
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
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
              <div className="text-sm text-text-muted">
                Repository: <span className="text-text font-mono">{selectedRepo.url}</span>
              </div>
            )}

            {error && (
              <Alert variant="danger">{error}</Alert>
            )}

            {!setupDone ? (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={creating}>
                  Back
                </Button>
                <Button onClick={handleCreate} className="flex-1" disabled={creating || !projectName.trim()}>
                  {creating ? (
                    <>
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Creating...
                    </>
                  ) : 'Create Project'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Alert variant="success">
                  Project created successfully!
                </Alert>
                <Button
                  onClick={() => navigate(`/project/${createdProjectId}`)}
                  className="w-full"
                >
                  Open Project
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
