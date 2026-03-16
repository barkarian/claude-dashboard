import { Router, type Request, type Response } from 'express';
import config from '../config.ts';

const router = Router();

function getTunnelHeaders(req: Request): Record<string, string> {
  const apiKey = req.session?.tunnelService?.apiKey;
  if (!apiKey) return {};
  return {
    'Authorization': `users API-Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// GET /api/devices — list user's paired devices
router.get('/', async (req: Request, res: Response) => {
  if (!config.tunnelServiceUrl || !req.session?.tunnelService?.apiKey) {
    return res.status(401).json({ error: 'Not connected to tunnel service' });
  }

  try {
    const response = await fetch(`${config.tunnelServiceUrl}/api/devices`, {
      headers: getTunnelHeaders(req),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch devices' });
  }
});

// POST /api/devices/generate-pairing — generate a pairing token + QR code data
router.post('/generate-pairing', async (req: Request, res: Response) => {
  if (!config.tunnelServiceUrl || !req.session?.tunnelService?.apiKey) {
    return res.status(401).json({ error: 'Not connected to tunnel service' });
  }

  try {
    const response = await fetch(`${config.tunnelServiceUrl}/api/devices/generate-pairing`, {
      method: 'POST',
      headers: getTunnelHeaders(req),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate pairing token' });
  }
});

// DELETE /api/devices/:id — remove a paired device
router.delete('/:id', async (req: Request, res: Response) => {
  if (!config.tunnelServiceUrl || !req.session?.tunnelService?.apiKey) {
    return res.status(401).json({ error: 'Not connected to tunnel service' });
  }

  try {
    const response = await fetch(`${config.tunnelServiceUrl}/api/devices/${req.params.id}`, {
      method: 'DELETE',
      headers: getTunnelHeaders(req),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete device' });
  }
});

export default router;
