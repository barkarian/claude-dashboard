import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import sshKeyService from '../services/sshKeyService.ts';

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

export default router;
