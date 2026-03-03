import { Router, type Request, type Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import config from '../config.ts';
import sshKeyService from '../services/sshKeyService.ts';
import credentialService from '../services/credentialService.ts';

const execFileAsync = promisify(execFile);

const router = Router();

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

// POST /api/credentials/auto-detect — detect local credentials (env vars, keychain, CLI configs)
router.post('/credentials/auto-detect', async (req: Request, res: Response) => {
  try {
    const results: { provider: string; saved: boolean; source?: string }[] = [];

    // Anthropic: env var → macOS Keychain (Claude Code OAuth)
    const anthropicKey = process.env.ANTHROPIC_API_KEY || await readClaudeKeychainToken();
    if (anthropicKey) {
      try {
        const keyPrefix = anthropicKey.slice(0, 10) + '...';
        await credentialService.setToken('anthropic', anthropicKey);
        results.push({ provider: 'anthropic', saved: true, source: process.env.ANTHROPIC_API_KEY ? 'env' : 'keychain' });
      } catch {
        results.push({ provider: 'anthropic', saved: false });
      }
    }

    // GitHub: env var → gh CLI auth token
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
        await credentialService.setToken('openrouter', openrouterKey);
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
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }
    const result = await credentialService.setToken('anthropic', apiKey);
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
    const { apiKey, opusModel, sonnetModel, haikuModel } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }
    const result = await credentialService.setToken('openrouter', apiKey, { opusModel, sonnetModel, haikuModel });
    res.json(result);
  } catch (err: any) {
    console.error('Error saving OpenRouter key:', err);
    res.status(500).json({ error: err.message || 'Failed to save API key' });
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
    const status = await credentialService.getStatus(provider);
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
    await credentialService.disconnectProvider(provider);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error disconnecting provider:', err);
    res.status(500).json({ error: err.message || 'Failed to disconnect provider' });
  }
});

export default router;
