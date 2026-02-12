import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

// GET /api/tunnel-auth/connect — redirect browser to tunnel-service OAuth
router.get('/connect', (req: Request, res: Response) => {
  if (config.tunnelMode !== 'tunnel-service' || !config.tunnelServiceUrl) {
    return res.status(400).json({ error: 'Tunnel service not configured' });
  }

  const callbackUrl = `http://localhost:${config.port}/api/tunnel-auth/callback`;
  const authorizeUrl = `${config.tunnelServiceUrl}/oauth/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&client_id=claude-dashboard`;

  res.redirect(authorizeUrl);
});

// GET /api/tunnel-auth/callback — receive auth code from tunnel-service OAuth
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  if (!config.tunnelServiceUrl) {
    return res.status(400).send('Tunnel service not configured');
  }

  try {
    // Exchange code for credentials
    const tokenRes = await fetch(`${config.tunnelServiceUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({ error: 'Token exchange failed' }));
      return res.status(400).send(`OAuth error: ${(err as any).error || 'Unknown error'}`);
    }

    const data = await tokenRes.json() as {
      user: { id: string; email: string; username: string; userSubdomain: string };
      apiKey: string;
    };

    if (!data.apiKey) {
      return res.status(400).send('No API key returned. Please enable API key in your tunnel-service account.');
    }

    // Store credentials in session
    req.session.tunnelService = {
      apiKey: data.apiKey,
      userSubdomain: data.user.userSubdomain,
      userId: data.user.id,
      email: data.user.email,
      username: data.user.username,
    };

    // Also set credentials on the tunnel manager for immediate use
    tunnelManager.setCredentials(data.apiKey, data.user.userSubdomain);

    // Redirect to the user's public tunnel URL if available, otherwise localhost
    if (config.tunnelDomain) {
      res.redirect(`https://${data.user.userSubdomain}.${config.tunnelDomain}`);
    } else {
      const frontendUrl = config.nodeEnv === 'development' ? 'http://localhost:5173' : '/';
      res.redirect(frontendUrl);
    }
  } catch (err) {
    console.error('[tunnel-auth] OAuth callback error:', err);
    res.status(500).send('Failed to complete OAuth flow');
  }
});

// GET /api/tunnel-auth/status — check if tunnel service is connected
router.get('/status', (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;

  res.json({
    connected: !!tunnelService,
    tunnelMode: config.tunnelMode,
    tunnelServiceUrl: config.tunnelServiceUrl,
    user: tunnelService ? {
      username: tunnelService.username,
      email: tunnelService.email,
      userSubdomain: tunnelService.userSubdomain,
    } : null,
  });
});

// POST /api/tunnel-auth/disconnect — clear tunnel credentials
router.post('/disconnect', (req: Request, res: Response) => {
  delete req.session.tunnelService;
  tunnelManager.clearCredentials();
  res.json({ success: true });
});

export default router;
