import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.ts';
import { Button } from '../components/ui/button.tsx';
import TruncatedPath from '../components/ui/truncated-path.tsx';
import Header from '../components/layout/Header.tsx';

interface MigrationProject {
  id: string;
  name: string;
  path: string;
  size: number;
  chatsCount: number;
  scriptsCount: number;
}

type MigrationItemStatus = 'pending' | 'exporting' | 'importing' | 'completed' | 'failed';

interface MigrationItem {
  projectId: string;
  name: string;
  status: MigrationItemStatus;
  progress: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function MigrationPage() {
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [allDone, setAllDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadRemoteProjects();
  }, []);

  async function loadRemoteProjects() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.post<{ projects: MigrationProject[] }>('/api/migrate/remote-projects');
      setProjects(data.projects || []);
      // Select all by default
      setSelected(new Set((data.projects || []).map((p: MigrationProject) => p.id)));
    } catch (err: any) {
      console.error('Failed to load remote projects:', err);
      setError(err.message || 'Failed to connect to local dashboard');
    } finally {
      setLoading(false);
    }
  }

  function toggleProject(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === projects.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(projects.map(p => p.id)));
    }
  }

  async function startMigration() {
    const selectedProjects = projects.filter(p => selected.has(p.id));
    if (selectedProjects.length === 0) return;

    setMigrating(true);
    const items: MigrationItem[] = selectedProjects.map(p => ({
      projectId: p.id,
      name: p.name,
      status: 'pending',
      progress: 0,
    }));
    setMigrations(items);

    // Migrate projects sequentially
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Update status: exporting
      items[i] = { ...item, status: 'exporting', progress: 25 };
      setMigrations([...items]);

      try {
        // Export from local dashboard
        const bundle = await api.post<{ metadata: any; archive: string }>(
          `/api/migrate/remote-export/${item.projectId}`
        );

        // Update status: importing
        items[i] = { ...item, status: 'importing', progress: 60 };
        setMigrations([...items]);

        // Import to VPS
        await api.post('/api/migrate/import', bundle);

        // Done
        items[i] = { ...item, status: 'completed', progress: 100 };
        setMigrations([...items]);
      } catch (err: any) {
        items[i] = { ...item, status: 'failed', progress: 0, error: err.message };
        setMigrations([...items]);
      }
    }

    setAllDone(true);
  }

  const totalSize = projects
    .filter(p => selected.has(p.id))
    .reduce((sum, p) => sum + p.size, 0);

  const completedCount = migrations.filter(m => m.status === 'completed').length;
  const failedCount = migrations.filter(m => m.status === 'failed').length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Migrate Projects" backTo="/" />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          {!migrating ? (
            <>
              {/* Header */}
              <div className="mb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 004.5 9.75v7.5a2.25 2.25 0 002.25 2.25h7.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25h-.75m-6 3.75l3 3m0 0l3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-7.5a2.25 2.25 0 01-2.25-2.25v-.75" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-text mb-1">Your VPS is ready!</h2>
                <p className="text-text-muted text-sm">
                  Migrate your projects from your local machine to the VPS. This transfers project files, chat history, scripts, and git configuration.
                </p>
              </div>

              {/* Error state */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
                  <p className="text-red-400 text-sm">{error}</p>
                  <button
                    onClick={loadRemoteProjects}
                    className="mt-2 text-sm text-red-400 underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Loading */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
                  <span className="ml-3 text-text-muted text-sm">Connecting to local dashboard...</span>
                </div>
              ) : projects.length === 0 && !error ? (
                <div className="text-center py-12">
                  <p className="text-text-muted mb-4">No projects found on your local machine.</p>
                  <Button
                    onClick={() => navigate('/')}
                  >
                    Start Fresh
                  </Button>
                </div>
              ) : projects.length > 0 ? (
                <>
                  {/* Select all */}
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.size === projects.length}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-border bg-bg-surface text-primary focus:ring-primary"
                      />
                      <span className="text-sm text-text-muted">Select all</span>
                    </label>
                    <span className="text-sm text-text-muted">
                      {selected.size} selected &middot; {formatBytes(totalSize)}
                    </span>
                  </div>

                  {/* Project list */}
                  <div className="space-y-2 mb-6">
                    {projects.map(project => (
                      <label
                        key={project.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-bg-surface border border-border cursor-pointer hover:border-primary/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(project.id)}
                          onChange={() => toggleProject(project.id)}
                          className="w-4 h-4 rounded border-border bg-bg text-primary focus:ring-primary flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-text truncate">{project.name}</div>
                          <TruncatedPath path={project.path} />
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm text-text-muted">{formatBytes(project.size)}</div>
                          <div className="text-xs text-text-dim">
                            {project.chatsCount} chat{project.chatsCount !== 1 ? 's' : ''}, {project.scriptsCount} script{project.scriptsCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <Button
                      onClick={startMigration}
                      disabled={selected.size === 0}
                      className="flex-1"
                    >
                      Migrate Selected ({selected.size})
                    </Button>
                    <button
                      onClick={() => navigate('/')}
                      className="px-4 py-2 rounded-lg border border-border text-text-muted hover:text-text hover:border-text-dim transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              {/* Migration progress */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-text mb-1">
                  {allDone ? 'Migration Complete' : 'Migrating Projects...'}
                </h2>
                {allDone && (
                  <p className="text-text-muted text-sm">
                    {completedCount} project{completedCount !== 1 ? 's' : ''} migrated successfully
                    {failedCount > 0 && `, ${failedCount} failed`}.
                  </p>
                )}
              </div>

              <div className="space-y-3 mb-6">
                {migrations.map(item => (
                  <div
                    key={item.projectId}
                    className="p-3 rounded-lg bg-bg-surface border border-border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-text">{item.name}</span>
                      <StatusBadge status={item.status} />
                    </div>

                    {/* Progress bar */}
                    {item.status !== 'failed' && (
                      <div className="w-full bg-bg rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${
                            item.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}

                    {item.error && (
                      <p className="text-xs text-red-400 mt-1">{item.error}</p>
                    )}
                  </div>
                ))}
              </div>

              {allDone && (
                <Button
                  onClick={() => navigate('/')}
                  className="w-full"
                >
                  Go to Projects
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: MigrationItemStatus }) {
  const config: Record<MigrationItemStatus, { label: string; className: string }> = {
    pending: { label: 'Waiting', className: 'text-text-dim bg-bg' },
    exporting: { label: 'Exporting...', className: 'text-primary bg-primary/10' },
    importing: { label: 'Importing...', className: 'text-primary bg-primary/10' },
    completed: { label: 'Done', className: 'text-green-400 bg-green-500/10' },
    failed: { label: 'Failed', className: 'text-red-400 bg-red-500/10' },
  };

  const { label, className } = config[status];

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>
      {label}
    </span>
  );
}
