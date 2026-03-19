import { Router, type Request, type Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import simpleGit from 'simple-git';
import config from '../config.ts';
import sshKeyService from '../services/sshKeyService.ts';
import credentialService from '../services/credentialService.ts';
import processManager from '../services/processManager.ts';

const execFileAsync = promisify(execFile);

const router = Router();

// POST /api/open-external — open a URL in the system browser (desktop mode only).
// The Tauri webview can't use target="_blank" or window.open() to launch the
// system browser, so the server does it via the OS "open" command.
router.post('/open-external', (req: Request, res: Response) => {
  if (process.env.CLAW_DESKTOP !== '1') {
    return res.status(403).json({ error: 'Only available in desktop mode' });
  }

  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  // Only allow opening URLs on our tunnel domain or localhost for safety
  try {
    const parsed = new URL(url);
    const isAllowed = parsed.hostname.endsWith('.claw-dev.com') || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isAllowed) {
      return res.status(400).json({ error: 'Only claw-dev.com and localhost URLs are allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Use platform-appropriate command to open in default browser
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [url], (err) => {
    if (err) console.error('[settings] Failed to open external URL:', err);
  });

  res.json({ success: true });
});

// --- Dashboard self-update state ---
let updating = false;
let updateError: string | null = null;

// GET /api/settings — return dashboard environment info
router.get('/settings', async (req: Request, res: Response) => {
  try {
    res.json({
      isVps: config.isVps,
      vpsIp: config.vpsIp,
      sshUser: config.sshUser,
      sshPort: config.sshPort,
      migrationAvailable: config.isVps && !!config.migrationSourceUrl,
    });
  } catch (err) {
    console.error('Error getting settings:', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// GET /api/settings/update-status — check for available updates
router.get('/settings/update-status', async (req: Request, res: Response) => {
  try {
    const git = simpleGit(process.cwd());
    const branch = await git.branch();
    const log = await git.log({ maxCount: 1 });

    if (!log.latest) {
      return res.status(500).json({ error: 'No commits found in repository' });
    }

    await git.fetch('origin', branch.current);

    const currentCommit = {
      hash: log.latest.hash.substring(0, 7),
      message: log.latest.message,
      date: log.latest.date,
    };

    // Check if remote has new commits
    const remoteLog = await git.log({
      from: log.latest.hash,
      to: `origin/${branch.current}`,
      maxCount: 1,
    });

    const hasUpdate = remoteLog.total > 0;
    const latestCommit = hasUpdate && remoteLog.latest
      ? {
          hash: remoteLog.latest.hash.substring(0, 7),
          message: remoteLog.latest.message,
          date: remoteLog.latest.date,
        }
      : currentCommit;

    res.json({
      currentCommit,
      currentBranch: branch.current,
      latestCommit,
      updateAvailable: hasUpdate,
      updating,
      updateError,
    });

    // Clear error after it's been read
    if (updateError) updateError = null;
  } catch (err: any) {
    console.error('Error checking update status:', err);
    res.status(500).json({ error: err.message || 'Failed to check update status' });
  }
});

// POST /api/settings/update — pull, rebuild, and restart the dashboard
router.post('/settings/update', async (req: Request, res: Response) => {
  if (updating) {
    return res.status(409).json({ error: 'Update already in progress' });
  }

  updating = true;
  updateError = null;
  res.json({ updating: true });

  // Fire-and-forget background update
  (async () => {
    try {
      const git = simpleGit(process.cwd());
      const branch = await git.branch();

      // Pull latest changes
      await git.pull('origin', branch.current);

      // Install dependencies
      await execFileAsync('npm', ['install'], { cwd: process.cwd() });

      // Build
      await execFileAsync('npm', ['run', 'build'], { cwd: process.cwd() });

      // Schedule restart after 1s
      setTimeout(() => {
        if (config.isVps) {
          execFile('sudo', ['systemctl', 'restart', 'claw-dashboard'], (err) => {
            if (err) console.error('Failed to restart via systemd:', err);
          });
        } else {
          process.exit(0);
        }
      }, 1000);
    } catch (err: any) {
      console.error('Update failed:', err);
      updating = false;
      updateError = err.message || 'Update failed';
    }
  })();
});

// GET /api/shell-preference — get account-level shell preference
router.get('/shell-preference', (req: Request, res: Response) => {
  const preferred = processManager.getPreferredShell();
  const defaultShell = process.platform === 'win32' ? 'powershell' : 'bash';
  res.json({
    accountShell: preferred || defaultShell,
    isDefault: !preferred,
    availableShells: ['bash', 'zsh', 'fish', 'sh', ...(process.platform === 'win32' ? ['powershell', 'wsl'] : [])],
  });
});

// GET /api/ssh-keys — list user's SSH keys (proxied from tunnel-service)
router.get('/ssh-keys', async (req: Request, res: Response) => {
  try {
    const keys = await sshKeyService.fetchSshKeys();
    res.json({ keys });
  } catch (err) {
    console.error('Error listing SSH keys:', err);
    res.status(500).json({ error: 'Failed to list SSH keys' });
  }
});

// POST /api/ssh-keys — add SSH key (proxied to tunnel-service + sync authorized_keys)
router.post('/ssh-keys', async (req: Request, res: Response) => {
  try {
    const { label, publicKey } = req.body;
    if (!label || !publicKey) {
      return res.status(400).json({ error: 'label and publicKey are required' });
    }
    const key = await sshKeyService.addSshKey(label, publicKey);
    res.status(201).json({ key });
  } catch (err: any) {
    console.error('Error adding SSH key:', err);
    res.status(500).json({ error: err.message || 'Failed to add SSH key' });
  }
});

// DELETE /api/ssh-keys/:id — remove SSH key (proxied to tunnel-service + sync authorized_keys)
router.delete('/ssh-keys/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    await sshKeyService.deleteSshKey(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting SSH key:', err);
    res.status(500).json({ error: err.message || 'Failed to delete SSH key' });
  }
});

// POST /api/ssh-keys/sync — trigger authorized_keys sync (called by tunnel-service via WebSocket)
router.post('/ssh-keys/sync', async (req: Request, res: Response) => {
  try {
    await sshKeyService.syncAuthorizedKeys();
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error syncing SSH keys:', err);
    res.status(500).json({ error: err.message || 'Failed to sync SSH keys' });
  }
});

// --- Credential routes ---

// Helper: read Claude Code OAuth token from macOS Keychain
async function readClaudeKeychainToken(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const user = process.env.USER || process.env.LOGNAME || '';
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-a', user, '-w',
    ]);
    const json = JSON.parse(stdout.trim());
    const token = json?.claudeAiOauth?.accessToken;
    return (token && typeof token === 'string') ? token : null;
  } catch {
    return null;
  }
}

// Helper: read GitHub token from gh CLI config
async function readGhCliToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

// GET /api/credentials/claude-login-status — check if Claude Code OAuth token exists in keychain
router.get('/credentials/claude-login-status', async (req: Request, res: Response) => {
  try {
    const token = await readClaudeKeychainToken();
    res.json({ detected: !!token, source: token ? 'keychain' : undefined });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to check Claude login status' });
  }
});

// POST /api/credentials/auto-detect — detect local credentials (env vars, keychain, CLI configs)
router.post('/credentials/auto-detect', async (req: Request, res: Response) => {
  try {
    const results: { provider: string; saved: boolean; source?: string }[] = [];

    const env = config.dashboardEnv;

    // Anthropic: env var → macOS Keychain (Claude Code OAuth)
    const anthropicKey = process.env.ANTHROPIC_API_KEY || await readClaudeKeychainToken();
    if (anthropicKey) {
      try {
        await credentialService.setToken('anthropic', anthropicKey, undefined, env);
        results.push({ provider: 'anthropic', saved: true, source: process.env.ANTHROPIC_API_KEY ? 'env' : 'keychain' });
      } catch {
        results.push({ provider: 'anthropic', saved: false });
      }
    }

    // GitHub: env var → gh CLI auth token (no environment)
    const githubToken = process.env.GITHUB_TOKEN || await readGhCliToken();
    if (githubToken) {
      try {
        await credentialService.setToken('github', githubToken);
        results.push({ provider: 'github', saved: true, source: process.env.GITHUB_TOKEN ? 'env' : 'gh-cli' });
      } catch {
        results.push({ provider: 'github', saved: false });
      }
    }

    // OpenRouter: env var
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      try {
        await credentialService.setToken('openrouter', openrouterKey, undefined, env);
        results.push({ provider: 'openrouter', saved: true, source: 'env' });
      } catch {
        results.push({ provider: 'openrouter', saved: false });
      }
    }

    res.json({ detected: results });
  } catch (err: any) {
    console.error('Error auto-detecting credentials:', err);
    res.status(500).json({ error: err.message || 'Failed to auto-detect credentials' });
  }
});

// PUT /api/credentials/anthropic — save Anthropic API key
router.put('/credentials/anthropic', async (req: Request, res: Response) => {
  try {
    const { apiKey, environment } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }
    const env = (environment === 'local' || environment === 'vps') ? environment : undefined;
    const result = await credentialService.setToken('anthropic', apiKey, undefined, env);
    res.json(result);
  } catch (err: any) {
    console.error('Error saving Anthropic key:', err);
    res.status(500).json({ error: err.message || 'Failed to save API key' });
  }
});

// PUT /api/credentials/github — save GitHub token
router.put('/credentials/github', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    const result = await credentialService.setToken('github', token);
    res.json(result);
  } catch (err: any) {
    console.error('Error saving GitHub token:', err);
    res.status(500).json({ error: err.message || 'Failed to save token' });
  }
});

// PUT /api/credentials/openrouter — save OpenRouter API key with model mappings
router.put('/credentials/openrouter', async (req: Request, res: Response) => {
  try {
    const { apiKey, opusModel, sonnetModel, haikuModel, environment } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }
    const env = (environment === 'local' || environment === 'vps') ? environment : undefined;
    const result = await credentialService.setToken('openrouter', apiKey, { opusModel, sonnetModel, haikuModel }, env);
    res.json(result);
  } catch (err: any) {
    console.error('Error saving OpenRouter key:', err);
    res.status(500).json({ error: err.message || 'Failed to save API key' });
  }
});

// PATCH /api/credentials/openrouter/models — update model mappings without re-submitting API key
router.patch('/credentials/openrouter/models', async (req: Request, res: Response) => {
  try {
    const { opusModel, sonnetModel, haikuModel, environment } = req.body;
    const env = (environment === 'local' || environment === 'vps') ? environment : undefined;
    const result = await credentialService.updateOpenrouterModels({ opusModel, sonnetModel, haikuModel }, env);
    res.json(result);
  } catch (err: any) {
    console.error('Error updating OpenRouter models:', err);
    res.status(500).json({ error: err.message || 'Failed to update models' });
  }
});

// POST /api/credentials/sync — trigger credential sync on VPS
router.post('/credentials/sync', async (req: Request, res: Response) => {
  try {
    await credentialService.syncCredentials();
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error syncing credentials:', err);
    res.status(500).json({ error: err.message || 'Failed to sync credentials' });
  }
});

// GET /api/credentials/:provider/status — get connection status
router.get('/credentials/:provider/status', async (req: Request<{ provider: string }>, res: Response) => {
  try {
    const provider = req.params.provider as 'anthropic' | 'github' | 'openrouter';
    if (provider !== 'anthropic' && provider !== 'github' && provider !== 'openrouter') {
      return res.status(400).json({ error: 'Invalid provider' });
    }
    const env = req.query.environment as string | undefined;
    const environment = (env === 'local' || env === 'vps') ? env : undefined;
    const status = await credentialService.getStatus(provider, environment);
    res.json(status);
  } catch (err: any) {
    console.error('Error getting credential status:', err);
    res.status(500).json({ error: err.message || 'Failed to get credential status' });
  }
});

// DELETE /api/credentials/:provider — disconnect a provider
router.delete('/credentials/:provider', async (req: Request<{ provider: string }>, res: Response) => {
  try {
    const provider = req.params.provider as 'anthropic' | 'github' | 'openrouter';
    if (provider !== 'anthropic' && provider !== 'github' && provider !== 'openrouter') {
      return res.status(400).json({ error: 'Invalid provider' });
    }
    const env = req.query.environment as string | undefined;
    const environment = (env === 'local' || env === 'vps') ? env : undefined;
    await credentialService.disconnectProvider(provider, environment);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error disconnecting provider:', err);
    res.status(500).json({ error: err.message || 'Failed to disconnect provider' });
  }
});

export default router;
