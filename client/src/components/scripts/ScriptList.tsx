import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api.ts';
import { useSocket } from '../../context/SocketContext.tsx';
import ScriptCard from './ScriptCard.tsx';
import RunningProcessCard from './RunningProcessCard.tsx';
import AddScriptModal from './AddScriptModal.tsx';
import AIScriptGenerator from './AIScriptGenerator.tsx';
import type { Project, ScriptWithStatus, RunningProcess } from '../../../../shared/types/models.ts';

interface ScriptListProps {
  projectId: string;
  project: Project;
}

export default function ScriptList({ projectId, project }: ScriptListProps) {
  const [scripts, setScripts] = useState<ScriptWithStatus[]>([]);
  const [runningProcesses, setRunningProcesses] = useState<RunningProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [spawningShell, setSpawningShell] = useState(false);
  const navigate = useNavigate();
  const { socket } = useSocket();

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadProcesses, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  async function loadAll() {
    await Promise.all([loadScripts(), loadProcesses()]);
  }

  async function loadScripts() {
    try {
      const data = await api.get<{ scripts: ScriptWithStatus[] }>(`/api/projects/${projectId}/scripts`);
      setScripts(data.scripts || []);
    } catch (err) {
      console.error('Failed to load scripts:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadProcesses(): Promise<void> {
    try {
      const data = await api.get<{ processes: RunningProcess[]; runningCount: number }>(`/api/projects/${projectId}/scripts/processes`);
      const running = (data.processes || []).filter((p: RunningProcess) => p.status === 'running');
      setRunningProcesses(running);
    } catch (err) {
      console.error('[ScriptList] Failed to load processes:', err);
    }
  }

  function handleRefresh() {
    loadAll();
  }

  async function handleDelete(scriptId: string) {
    try {
      await api.delete(`/api/projects/${projectId}/scripts/${scriptId}`);
      setScripts(scripts.filter(s => s.id !== scriptId));
      loadProcesses();
    } catch (err) {
      console.error('Failed to delete script:', err);
    }
  }

  function handleNewTerminal() {
    if (!socket || spawningShell) return;
    setSpawningShell(true);

    function onShellSpawned({ projectId: pid, scriptId }: { projectId: string; scriptId: string }) {
      if (pid === projectId) {
        socket!.off('terminal:shell-spawned', onShellSpawned);
        setSpawningShell(false);
        navigate(`/project/${projectId}/scripts/${scriptId}`);
      }
    }

    socket.on('terminal:shell-spawned', onShellSpawned);
    socket.emit('terminal:spawn-shell', { projectId });

    // Timeout fallback
    setTimeout(() => {
      socket.off('terminal:shell-spawned', onShellSpawned);
      setSpawningShell(false);
    }, 5000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const hasRunning = runningProcesses.length > 0;

  return (
    <div className="p-4 space-y-3">
      {hasRunning && (
        <>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Running ({runningProcesses.length})
          </h3>
          {runningProcesses.map((proc) => (
            <RunningProcessCard
              key={proc.scriptId}
              process={proc}
              projectId={projectId}
              onRefresh={handleRefresh}
            />
          ))}
        </>
      )}

      {hasRunning && scripts.length > 0 && (
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider pt-2">
          Defined Scripts
        </h3>
      )}

      {scripts.length === 0 && !hasRunning ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h3 className="text-text font-medium mb-1">No scripts yet</h3>
          <p className="text-text-muted text-sm mb-4">Add scripts to run dev servers, tests, etc.</p>
        </div>
      ) : (
        scripts.map((script) => (
          <ScriptCard
            key={script.id}
            script={script}
            projectId={projectId}
            onDelete={handleDelete}
            onRefresh={handleRefresh}
          />
        ))
      )}

      {/* AI Script Generator */}
      {showAIGenerator && (
        <AIScriptGenerator
          projectId={projectId}
          onClose={() => setShowAIGenerator(false)}
          onScriptsAdded={() => { setShowAIGenerator(false); handleRefresh(); }}
        />
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setShowModal(true)}
          className="btn-outline flex-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Script
        </button>

        {!showAIGenerator && (
          <button
            onClick={() => setShowAIGenerator(true)}
            className="btn-outline flex-1 border-primary/30 text-primary hover:bg-primary/10"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
            Generate with AI
          </button>
        )}
      </div>

      <button
        onClick={handleNewTerminal}
        disabled={spawningShell}
        className="btn-outline w-full"
      >
        {spawningShell ? (
          <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
        )}
        New Terminal
      </button>

      {showModal && (
        <AddScriptModal
          projectId={projectId}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); handleRefresh(); }}
        />
      )}
    </div>
  );
}
