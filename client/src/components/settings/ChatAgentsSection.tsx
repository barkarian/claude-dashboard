/**
 * ChatAgentsSection — settings UI for managing chat adapters.
 *
 * Lists all registered adapters with enable/disable toggle,
 * prerequisites status, authentication, and API configuration.
 */

import { useState, useCallback } from 'react';
import { Button } from '../ui/button.tsx';
import { useAdapterSettings, type AdapterInfo } from '../../hooks/useAdapterSettings.ts';
import { useSocket } from '../../context/SocketContext.tsx';

function AdapterCard({ adapter, onToggle, onSaveSettings }: {
  adapter: AdapterInfo;
  onToggle: (enabled: boolean) => void;
  onSaveSettings: (updates: Record<string, string | null>) => void;
}) {
  const { metadata, settings, prerequisites, authStatus, enabled } = adapter;
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const { socket } = useSocket();

  // Install handler (reuses AIToolsSection pattern)
  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState('');

  const handleInstall = useCallback(() => {
    if (!socket) return;
    setInstalling(true);
    setInstallOutput('');
    // Use the existing tool install mechanism for claude-code
    socket.emit('tools:install', { toolId: 'claude-code' });

    const onOutput = ({ toolId, data }: { toolId: string; data: string }) => {
      if (toolId === 'claude-code') setInstallOutput(prev => prev + data);
    };
    const onComplete = ({ toolId }: { toolId: string; success: boolean }) => {
      if (toolId === 'claude-code') {
        setInstalling(false);
        socket.off('tools:install-output', onOutput);
        socket.off('tools:install-complete', onComplete);
      }
    };

    socket.on('tools:install-output', onOutput);
    socket.on('tools:install-complete', onComplete);
  }, [socket]);

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const provider = settings.api_provider || 'anthropic';
      const keyField = provider === 'openrouter' ? 'openrouter_api_key' : 'anthropic_api_key';
      onSaveSettings({ [keyField]: apiKey.trim() });
      setApiKey('');
    } finally {
      setSaving(false);
    }
  }, [apiKey, settings.api_provider, onSaveSettings]);

  const handleDisconnectKey = useCallback(() => {
    const provider = settings.api_provider || 'anthropic';
    const keyField = provider === 'openrouter' ? 'openrouter_api_key' : 'anthropic_api_key';
    onSaveSettings({ [keyField]: null });
  }, [settings.api_provider, onSaveSettings]);

  const prereqSatisfied = !metadata.capabilities.prerequisites || prerequisites?.satisfied;
  const isAuthenticated = authStatus?.authenticated;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-bg-hover/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${metadata.badgeColor}`}>
            {metadata.shortLabel}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{metadata.displayName}</div>
            <div className="text-xs text-text-muted truncate">{metadata.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {/* Status dots */}
          {prereqSatisfied && isAuthenticated && (
            <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
          )}
          {prereqSatisfied && !isAuthenticated && (
            <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" />
          )}
          {!prereqSatisfied && (
            <span className="w-2 h-2 rounded-full bg-text-dim flex-shrink-0" />
          )}
          {/* Enable/disable toggle */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(!enabled); }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              enabled ? 'bg-primary' : 'bg-bg-hover'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-4.5' : 'translate-x-0.5'
            }`} />
          </button>
          {/* Expand chevron */}
          <svg
            className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border bg-bg px-4 py-3 space-y-3">
          {/* Prerequisites status */}
          {metadata.capabilities.prerequisites && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-text-dim uppercase tracking-wider">CLI Status</div>
                {prereqSatisfied ? (
                  <div className="text-xs text-success mt-0.5">Installed</div>
                ) : (
                  <div className="text-xs text-text-muted mt-0.5">
                    {prerequisites?.message || 'Not installed'}
                  </div>
                )}
              </div>
              {!prereqSatisfied && !installing && (
                <Button size="sm" onClick={handleInstall}>Install</Button>
              )}
              {installing && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-text-muted">Installing...</span>
                </div>
              )}
            </div>
          )}

          {/* Install output */}
          {installOutput && (
            <pre className="text-xs font-mono text-text-muted bg-bg-surface rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
              {installOutput}
            </pre>
          )}

          {/* Authentication status */}
          <div>
            <div className="text-xs font-medium text-text-dim uppercase tracking-wider">Authentication</div>
            {isAuthenticated ? (
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-success">
                  Connected
                  {authStatus?.source === 'oauth' && ' (OAuth)'}
                  {authStatus?.source === 'env' && ' (Environment variable)'}
                  {authStatus?.source === 'api_key' && ' (API Key)'}
                </div>
                {authStatus?.source === 'api_key' && (
                  <Button variant="ghost" size="sm" onClick={handleDisconnectKey}>
                    Disconnect
                  </Button>
                )}
              </div>
            ) : (
              <div className="mt-1 space-y-2">
                {metadata.id === 'claude-code' && (
                  <p className="text-xs text-text-muted">
                    Run <code className="bg-bg-surface px-1 py-0.5 rounded font-mono">claude /login</code> in a terminal to authenticate via OAuth, or enter an API key below.
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Anthropic API Key (sk-ant-...)"
                    className="flex-1 text-xs bg-bg-surface border border-border rounded px-2 py-1.5 text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <Button size="sm" onClick={handleSaveApiKey} disabled={saving || !apiKey.trim()}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Bundled status for adapters without prerequisites */}
          {!metadata.capabilities.prerequisites && (
            <div>
              <div className="text-xs font-medium text-text-dim uppercase tracking-wider">Status</div>
              <div className="text-xs text-success mt-0.5">Available (bundled)</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatAgentsSection() {
  const { adapters, loading, refresh, updateSettings, toggleEnabled } = useAdapterSettings();

  if (loading) {
    return (
      <div id="chat-agents" className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="h-5 w-48 bg-bg-hover rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-16 bg-bg-hover rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div id="chat-agents" className="bg-bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
          Chat Agents
        </h3>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {adapters.length === 0 ? (
        <p className="text-sm text-text-muted">No chat adapters found.</p>
      ) : (
        <div className="space-y-3">
          {adapters.map(adapter => (
            <AdapterCard
              key={adapter.metadata.id}
              adapter={adapter}
              onToggle={(enabled) => toggleEnabled(adapter.metadata.id, enabled)}
              onSaveSettings={(updates) => updateSettings(adapter.metadata.id, updates)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-text-dim mt-3">
        Enable adapters to use them when creating new chats. Each adapter can be configured independently.
      </p>
    </div>
  );
}
