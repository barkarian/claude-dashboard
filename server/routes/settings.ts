import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import sshKeyService from '../services/sshKeyService.ts';
import credentialService from '../services/credentialService.ts';

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

// PUT /api/credentials/anthropic — save Anthropic API key
router.put('/credentials/anthropic', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }
    const result = await credentialService.setAnthropicKey(apiKey);
    res.json(result);
  } catch (err: any) {
    console.error('Error saving Anthropic key:', err);
    res.status(500).json({ error: err.message || 'Failed to save API key' });
  }
});

// PUT /api/credentials/github/app — save user's GitHub OAuth App credentials
router.put('/credentials/github/app', async (req: Request, res: Response) => {
  try {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'clientId and clientSecret are required' });
    }
    const result = await credentialService.setGitHubApp(clientId, clientSecret);
    res.json(result);
  } catch (err: any) {
    console.error('Error saving GitHub app config:', err);
    res.status(500).json({ error: err.message || 'Failed to save GitHub app config' });
  }
});

// GET /api/credentials/github/connect-url — get GitHub OAuth start URL (before :provider routes)
router.get('/credentials/github/connect-url', async (req: Request, res: Response) => {
  try {
    // Build redirect URI from request origin or config
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/settings`;

    const url = await credentialService.getGitHubConnectUrl(redirectUri);
    res.json({ url });
  } catch (err: any) {
    console.error('Error getting GitHub connect URL:', err);
    res.status(500).json({ error: err.message || 'Failed to get connect URL' });
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

// GET /api/credentials/:provider/status — get connection status for a provider
router.get('/credentials/:provider/status', async (req: Request<{ provider: string }>, res: Response) => {
  try {
    const provider = req.params.provider as 'anthropic' | 'github';
    if (provider !== 'anthropic' && provider !== 'github') {
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
    const provider = req.params.provider as 'anthropic' | 'github';
    if (provider !== 'anthropic' && provider !== 'github') {
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
