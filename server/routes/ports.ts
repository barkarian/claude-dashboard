import { Router, type Request, type Response } from 'express';
import tunnelManager from '../services/tunnelManager.ts';

const router = Router();

// PATCH /api/ports/:port/privacy — toggle port public/private
router.patch('/:port/privacy', async (req: Request, res: Response) => {
  const port = parseInt(req.params.port, 10);
  if (isNaN(port)) {
    return res.status(400).json({ error: 'Invalid port number' });
  }

  const { isPublic } = req.body as { isPublic?: boolean };
  if (typeof isPublic !== 'boolean') {
    return res.status(400).json({ error: 'isPublic must be a boolean' });
  }

  const success = await tunnelManager.setPortPrivacy(port, isPublic);
  if (!success) {
    return res.status(404).json({ error: 'Port not found or tunnel service unavailable' });
  }

  res.json({ port, isPublic });
});

// GET /api/ports — list all registered ports with their privacy settings
router.get('/', (_req: Request, res: Response) => {
  const tunnels = tunnelManager.getServiceTunnels();
  const ports = Array.from(tunnels.entries()).map(([port, entry]) => ({
    port,
    url: entry.url,
    isPublic: entry.isPublic,
    processKey: entry.processKey,
  }));
  res.json({ ports });
});

export default router;
