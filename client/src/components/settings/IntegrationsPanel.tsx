import { useState, useEffect } from 'react';
import { Button } from '../ui/button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';
import SettingsTerminal from './SettingsTerminal.tsx';

interface CredentialStatus {
  connected: boolean;
  metadata?: {
    keyPrefix?: string;
    tokenPrefix?: string;
  };
}

export default function IntegrationsPanel() {
  const { user } = useAuth();
  const [anthropicStatus, setAnthropicStatus] = useState<CredentialStatus>({ connected: false });
  const [githubStatus, setGithubStatus] = useState<CredentialStatus>({ connected: false });
  const [loading, setLoading] = useState(true);

  const [showAnthropicForm, setShowAnthropicForm] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [savingAnthropic, setSavingAnthropic] = useState(false);

  const [showGithubForm, setShowGithubForm] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [savingGithub, setSavingGithub] = useState(false);

  const [showTerminal, setShowTerminal] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadStatuses();
  }, []);

  async function loadStatuses() {
    setLoading(true);
    try {
      const [anthro, gh] = await Promise.all([
        api.get<CredentialStatus>('/api/credentials/anthropic/status'),
        api.get<CredentialStatus>('/api/credentials/github/status'),
      ]);
      setAnthropicStatus(anthro);
      setGithubStatus(gh);

      // Auto-detect local env credentials for any disconnected provider
      if (!anthro.connected || !gh.connected) {
        try {
          const { detected } = await api.post<{ detected: { provider: string; saved: boolean }[] }>('/api/credentials/auto-detect', {});
          if (detected.length > 0) {
            // Re-fetch statuses if anything was detected
            const [anthro2, gh2] = await Promise.all([
              api.get<CredentialStatus>('/api/credentials/anthropic/status'),
              api.get<CredentialStatus>('/api/credentials/github/status'),
            ]);
            setAnthropicStatus(anthro2);
            setGithubStatus(gh2);
          }
        } catch {
          // Auto-detect is best-effort, ignore failures
        }
      }
    } catch (err) {
      console.error('Failed to load credential statuses:', err);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSaveAnthropic(e: React.FormEvent) {
    e.preventDefault();
    if (!anthropicKey.trim()) return;
    setSavingAnthropic(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/anthropic', { apiKey: anthropicKey.trim() });
      setAnthropicStatus(result);
      setAnthropicKey('');
      setShowAnthropicForm(false);
      showToast('Anthropic API key saved');
    } catch (err) {
      console.error('Failed to save Anthropic key:', err);
    } finally {
      setSavingAnthropic(false);
    }
  }

  async function handleSaveGithub(e: React.FormEvent) {
    e.preventDefault();
    if (!githubToken.trim()) return;
    setSavingGithub(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/github', { token: githubToken.trim() });
      setGithubStatus(result);
      setGithubToken('');
      setShowGithubForm(false);
      showToast('GitHub token saved');
    } catch (err) {
      console.error('Failed to save GitHub token:', err);
    } finally {
      setSavingGithub(false);
    }
  }

  async function handleDisconnect(provider: 'anthropic' | 'github') {
    setDisconnecting(provider);
    try {
      await api.delete(`/api/credentials/${provider}`);
      if (provider === 'anthropic') {
        setAnthropicStatus({ connected: false });
      } else {
        setGithubStatus({ connected: false });
      }
      showToast(`${provider === 'anthropic' ? 'Claude Code' : 'GitHub'} disconnected`);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnecting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (user?.plan !== 'pro') {
    return null;
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="bg-success/10 border border-success/20 text-success rounded-lg px-4 py-2 text-sm">
          {toast}
        </div>
      )}

      <h3 className="text-base font-semibold text-text flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.536a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.25 8.497" />
        </svg>
        Integrations
      </h3>

      {/* Claude Code Card */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              C
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">Claude Code</h4>
              {anthropicStatus.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{anthropicStatus.metadata?.keyPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Add your Anthropic API key</p>
              )}
            </div>
          </div>

          {anthropicStatus.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('anthropic')}
              disabled={disconnecting === 'anthropic'}
            >
              {disconnecting === 'anthropic' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAnthropicForm(!showAnthropicForm)}>
              Connect
            </Button>
          )}
        </div>

        {showAnthropicForm && !anthropicStatus.connected && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Get an API key:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.anthropic.com/settings/keys</a></li>
                <li>Click "Create Key" and copy it</li>
              </ol>
              <p className="mt-2">
                You can also use <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">claude login</code> via SSH for OAuth with a Claude subscription (Pro, Max, Team, Enterprise).
              </p>
              <p className="mt-1">
                <button type="button" onClick={() => setShowTerminal(true)} className="text-primary underline hover:text-primary-dark">
                  Open a terminal
                </button> to run <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">claude login</code> directly.
              </p>
            </div>

            <form onSubmit={handleSaveAnthropic} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">API Key</label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowAnthropicForm(false); setAnthropicKey(''); }}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={savingAnthropic || !anthropicKey.trim()}>
                  {savingAnthropic ? 'Saving...' : 'Save Key'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* GitHub Card */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">GitHub</h4>
              {githubStatus.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{githubStatus.metadata?.tokenPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Add your GitHub personal access token</p>
              )}
            </div>
          </div>

          {githubStatus.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('github')}
              disabled={disconnecting === 'github'}
            >
              {disconnecting === 'github' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowGithubForm(!showGithubForm)}>
              Connect
            </Button>
          )}
        </div>

        {showGithubForm && !githubStatus.connected && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Create a Personal Access Token:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer" className="text-primary underline">GitHub Token Settings</a></li>
                <li>Click "Generate new token" (fine-grained)</li>
                <li>Set a name, expiration, and select the repositories you want access to</li>
                <li>Under "Permissions", grant <strong>Contents</strong> (read & write) at minimum</li>
                <li>Click "Generate token" and copy it</li>
              </ol>
              <p className="mt-1">
                Or <button type="button" onClick={() => setShowTerminal(true)} className="text-primary underline hover:text-primary-dark">open a terminal</button> to run <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">gh auth login</code> directly.
              </p>
            </div>

            <form onSubmit={handleSaveGithub} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Personal Access Token</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="github_pat_..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowGithubForm(false); setGithubToken(''); }}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={savingGithub || !githubToken.trim()}>
                  {savingGithub ? 'Saving...' : 'Save Token'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Terminal section */}
      {showTerminal ? (
        <SettingsTerminal onClose={() => setShowTerminal(false)} />
      ) : (
        <button
          onClick={() => setShowTerminal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-text-muted hover:text-text bg-bg-surface border border-border rounded-xl hover:border-primary/30 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Open Terminal
        </button>
      )}
    </div>
  );
}
