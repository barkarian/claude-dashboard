import { useState, useEffect } from 'react';
import { Button } from '../ui/button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';

interface AnthropicStatus {
  connected: boolean;
  metadata?: {
    keyPrefix?: string;
  };
}

interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  metadata?: {
    clientId?: string;
    login?: string;
    avatarUrl?: string;
  };
}

export default function IntegrationsPanel() {
  const { user } = useAuth();
  const [anthropicStatus, setAnthropicStatus] = useState<AnthropicStatus>({ connected: false });
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({ configured: false, connected: false });
  const [loading, setLoading] = useState(true);

  // Anthropic form
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false);

  // GitHub app config form
  const [showGitHubSetup, setShowGitHubSetup] = useState(false);
  const [ghClientId, setGhClientId] = useState('');
  const [ghClientSecret, setGhClientSecret] = useState('');
  const [savingGitHubApp, setSavingGitHubApp] = useState(false);

  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [connectingGithub, setConnectingGithub] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadStatuses();

    // Detect ?github=connected query param from OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('github') === 'connected') {
      setToast('GitHub connected successfully');
      const url = new URL(window.location.href);
      url.searchParams.delete('github');
      window.history.replaceState({}, '', url.pathname + url.search);
      setTimeout(() => setToast(null), 3000);
    }
  }, []);

  async function loadStatuses() {
    setLoading(true);
    try {
      const [anthro, gh] = await Promise.all([
        api.get<AnthropicStatus>('/api/credentials/anthropic/status'),
        api.get<GitHubStatus>('/api/credentials/github/status'),
      ]);
      setAnthropicStatus(anthro);
      setGithubStatus(gh);
    } catch (err) {
      console.error('Failed to load credential statuses:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveAnthropicKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setSavingAnthropicKey(true);
    try {
      const result = await api.put<AnthropicStatus>('/api/credentials/anthropic', { apiKey: apiKey.trim() });
      setAnthropicStatus(result);
      setApiKey('');
      setShowApiKeyForm(false);
      setToast('Anthropic API key saved');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to save Anthropic key:', err);
    } finally {
      setSavingAnthropicKey(false);
    }
  }

  async function handleSaveGitHubApp(e: React.FormEvent) {
    e.preventDefault();
    if (!ghClientId.trim() || !ghClientSecret.trim()) return;

    setSavingGitHubApp(true);
    try {
      await api.put('/api/credentials/github/app', {
        clientId: ghClientId.trim(),
        clientSecret: ghClientSecret.trim(),
      });
      setGhClientId('');
      setGhClientSecret('');
      setShowGitHubSetup(false);
      // Refresh status
      const gh = await api.get<GitHubStatus>('/api/credentials/github/status');
      setGithubStatus(gh);
      setToast('GitHub OAuth App configured');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to save GitHub app config:', err);
    } finally {
      setSavingGitHubApp(false);
    }
  }

  async function handleDisconnect(provider: 'anthropic' | 'github') {
    setDisconnecting(provider);
    try {
      await api.delete(`/api/credentials/${provider}`);
      if (provider === 'anthropic') {
        setAnthropicStatus({ connected: false });
      } else {
        setGithubStatus({ configured: false, connected: false });
      }
      setToast(`${provider === 'anthropic' ? 'Claude Code' : 'GitHub'} disconnected`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleConnectGithub() {
    setConnectingGithub(true);
    try {
      const data = await api.get<{ url: string }>('/api/credentials/github/connect-url');
      window.location.href = data.url;
    } catch (err) {
      console.error('Failed to get GitHub connect URL:', err);
      setConnectingGithub(false);
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
      {/* Toast */}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowApiKeyForm(!showApiKeyForm)}
            >
              Connect
            </Button>
          )}
        </div>

        {showApiKeyForm && !anthropicStatus.connected && (
          <form onSubmit={handleSaveAnthropicKey} className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Anthropic API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowApiKeyForm(false);
                  setApiKey('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingAnthropicKey || !apiKey.trim()}
              >
                {savingAnthropicKey ? 'Saving...' : 'Save Key'}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* GitHub Card */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {githubStatus.connected && githubStatus.metadata?.avatarUrl ? (
              <img
                src={githubStatus.metadata.avatarUrl}
                alt={githubStatus.metadata.login}
                className="w-10 h-10 rounded-lg"
              />
            ) : (
              <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </div>
            )}
            <div>
              <h4 className="text-sm font-semibold text-text">GitHub</h4>
              {githubStatus.connected ? (
                <p className="text-xs text-text-muted">
                  Connected as <span className="font-semibold">{githubStatus.metadata?.login}</span>
                </p>
              ) : githubStatus.configured ? (
                <p className="text-xs text-text-muted">
                  OAuth App configured &middot; <span className="font-mono">{githubStatus.metadata?.clientId}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Set up your GitHub OAuth App</p>
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
          ) : githubStatus.configured ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger-dark"
                onClick={() => handleDisconnect('github')}
                disabled={disconnecting === 'github'}
              >
                Remove
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnectGithub}
                disabled={connectingGithub}
              >
                {connectingGithub ? 'Redirecting...' : 'Connect'}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGitHubSetup(!showGitHubSetup)}
            >
              Set Up
            </Button>
          )}
        </div>

        {/* GitHub OAuth App setup form */}
        {showGitHubSetup && !githubStatus.configured && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Create a GitHub OAuth App:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer" className="text-primary underline">GitHub Developer Settings</a></li>
                <li>Click "New OAuth App"</li>
                <li>Set <strong>Homepage URL</strong> to your dashboard URL</li>
                <li>Set <strong>Authorization callback URL</strong> to:<br />
                  <code className="px-1.5 py-0.5 bg-bg-surface rounded font-mono text-text">
                    https://tunnel-api.claw-dev.com/api/integrations/github/callback
                  </code>
                </li>
                <li>Copy the Client ID and generate a Client Secret</li>
              </ol>
            </div>

            <form onSubmit={handleSaveGitHubApp} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Client ID</label>
                <input
                  type="text"
                  value={ghClientId}
                  onChange={(e) => setGhClientId(e.target.value)}
                  placeholder="Iv1.abc123..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Client Secret</label>
                <input
                  type="password"
                  value={ghClientSecret}
                  onChange={(e) => setGhClientSecret(e.target.value)}
                  placeholder="Your client secret"
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowGitHubSetup(false);
                    setGhClientId('');
                    setGhClientSecret('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingGitHubApp || !ghClientId.trim() || !ghClientSecret.trim()}
                >
                  {savingGitHubApp ? 'Saving...' : 'Save & Continue'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
