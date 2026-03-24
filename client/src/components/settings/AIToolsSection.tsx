import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/button.tsx';
import { useSocket } from '../../context/SocketContext.tsx';
import api from '../../utils/api.ts';

interface ToolInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  binaryPath?: string;
  installCommand: string;
}

export default function AIToolsSection() {
  const { socket } = useSocket();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installOutput, setInstallOutput] = useState<Record<string, string>>({});
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const outputRefs = useRef<Record<string, HTMLPreElement | null>>({});

  const fetchTools = useCallback(async () => {
    try {
      const data = await api.get<{ tools: ToolInfo[] }>('/api/tools/status');
      setTools(data.tools);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  // Socket listeners for install progress
  useEffect(() => {
    if (!socket) return;

    function onInstallStarted({ toolId }: { toolId: string }) {
      setInstalling(prev => ({ ...prev, [toolId]: true }));
      setInstallOutput(prev => ({ ...prev, [toolId]: '' }));
      setExpandedTool(toolId);
    }

    function onInstallOutput({ toolId, data }: { toolId: string; data: string }) {
      setInstallOutput(prev => ({
        ...prev,
        [toolId]: (prev[toolId] || '') + data,
      }));
      // Auto-scroll
      requestAnimationFrame(() => {
        const el = outputRefs.current[toolId];
        if (el) el.scrollTop = el.scrollHeight;
      });
    }

    function onInstallComplete({ toolId, success, tool }: { toolId: string; success: boolean; error?: string; tool?: ToolInfo }) {
      setInstalling(prev => ({ ...prev, [toolId]: false }));
      if (success && tool) {
        setTools(prev => prev.map(t => t.id === toolId ? tool : t));
      }
    }

    socket.on('tools:install-started', onInstallStarted);
    socket.on('tools:install-output', onInstallOutput);
    socket.on('tools:install-complete', onInstallComplete);

    return () => {
      socket.off('tools:install-started', onInstallStarted);
      socket.off('tools:install-output', onInstallOutput);
      socket.off('tools:install-complete', onInstallComplete);
    };
  }, [socket]);

  function handleInstall(toolId: string) {
    if (!socket) return;
    socket.emit('tools:install', { toolId });
  }

  function handleCancel(toolId: string) {
    if (!socket) return;
    socket.emit('tools:install-cancel', { toolId });
    setInstalling(prev => ({ ...prev, [toolId]: false }));
  }

  if (loading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="h-5 w-48 bg-bg-hover rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-bg-hover rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          AI Development Tools
        </h3>
        <Button variant="ghost" size="sm" onClick={fetchTools}>
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {tools.map(tool => {
          const isInstalling = installing[tool.id];
          const output = installOutput[tool.id];
          const isExpanded = expandedTool === tool.id;

          return (
            <div key={tool.id} className="border border-border rounded-lg overflow-hidden">
              {/* Tool header */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tool.installed ? 'bg-success' : 'bg-text-dim'}`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">{tool.name}</div>
                    <div className="text-xs text-text-muted truncate">{tool.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  {tool.installed && tool.version && (
                    <span className="text-xs font-mono text-text-muted">v{tool.version}</span>
                  )}
                  {isInstalling ? (
                    <Button variant="outline" size="sm" onClick={() => handleCancel(tool.id)}>
                      Cancel
                    </Button>
                  ) : tool.installed ? (
                    <span className="text-xs text-success font-medium px-2 py-1 rounded bg-success/10">Installed</span>
                  ) : (
                    <Button variant="default" size="sm" onClick={() => handleInstall(tool.id)}>
                      Install
                    </Button>
                  )}
                </div>
              </div>

              {/* Install output */}
              {isInstalling && (
                <div className="border-t border-border bg-bg px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-text-muted">Installing...</span>
                  </div>
                  <pre
                    ref={el => { outputRefs.current[tool.id] = el; }}
                    className="text-xs font-mono text-text-muted bg-bg-surface rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap"
                  >{output || 'Starting installation...'}</pre>
                </div>
              )}

              {/* Completed install output (collapsible) */}
              {!isInstalling && output && (
                <div className="border-t border-border bg-bg px-3 py-2">
                  <button
                    onClick={() => setExpandedTool(isExpanded ? null : tool.id)}
                    className="text-xs text-text-muted hover:text-text transition-colors"
                  >
                    {isExpanded ? 'Hide output' : 'Show install output'}
                  </button>
                  {isExpanded && (
                    <pre className="text-xs font-mono text-text-muted bg-bg-surface rounded p-2 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {output}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-dim mt-3">
        Tools are installed globally via npm. Run the install commands manually in a terminal for more control.
      </p>
    </div>
  );
}
