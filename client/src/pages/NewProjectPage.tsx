import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.ts';
import { useSocket } from '../context/SocketContext.tsx';
import Header from '../components/layout/Header.tsx';
import RepoSelector from '../components/projects/RepoSelector.tsx';
import SetupTerminal from '../components/projects/SetupTerminal.tsx';
import type { GitHubRepo } from '../../../shared/types/models.ts';

export default function NewProjectPage() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [step, setStep] = useState(1);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [setupSessionId, setSetupSessionId] = useState<string | null>(null);
  const [setupDone, setSetupDone] = useState(false);
  const [error, setError] = useState('');

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
      const data = await api.post<{ setupSessionId: string }>('/api/projects', { name: projectName, repoUrl });
      setSetupSessionId(data.setupSessionId);
      setSetupDone(true);
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
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  className="input flex-1"
                  placeholder="https://github.com/user/repo.git"
                />
                <button onClick={handleCustomUrl} disabled={!customUrl.trim()} className="btn-primary whitespace-nowrap disabled:opacity-50">
                  Clone
                </button>
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
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="input flex-1"
                  placeholder="project-name"
                />
                <button
                  onClick={() => { setSelectedRepo(null); setStep(2); }}
                  disabled={!projectName.trim()}
                  className="btn-outline whitespace-nowrap disabled:opacity-50"
                >
                  Create Empty
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="input"
              />
            </div>

            {selectedRepo?.url && (
              <div className="text-sm text-text-muted">
                Repository: <span className="text-text font-mono">{selectedRepo.url}</span>
              </div>
            )}

            {error && (
              <div className="text-danger text-sm bg-danger/10 px-3 py-2 rounded-lg">{error}</div>
            )}

            {!setupDone ? (
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="btn-ghost" disabled={creating}>
                  Back
                </button>
                <button onClick={handleCreate} className="btn-primary flex-1" disabled={creating || !projectName.trim()}>
                  {creating ? (
                    <>
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Creating...
                    </>
                  ) : 'Create Project'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="badge-success text-sm px-3 py-2 rounded-lg bg-success/10">
                  Project created successfully!
                </div>
                <button
                  onClick={() => navigate(`/project/${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`)}
                  className="btn-primary w-full"
                >
                  Open Project
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
