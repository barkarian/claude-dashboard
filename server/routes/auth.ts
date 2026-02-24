import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

router.post('/logout', (req: Request, res: Response) => {
  console.log('[auth] Logout requested');

  // Clear cached user info so auto-bootstrap stops re-authenticating tunnel requests.
  // The tunnel itself stays connected so the user can re-login through the tunnel URL.
  tunnelManager.clearUserInfo();

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    console.log('[auth] Session destroyed, user info cleared (tunnel stays open for re-login)');
    return res.json({ success: true });
  });
});

router.get('/status', (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  const authenticated = !!tunnelService;

  const oauthUrl = config.tunnelMode === 'tunnel-service' && config.tunnelServiceUrl
    ? '/api/tunnel-auth/connect'
    : null;

  const sessionId = req.sessionID ? req.sessionID.slice(0, 8) + '...' : 'none';
  console.log(`[auth] /status check: authenticated=${authenticated}, sessionId=${sessionId}, user=${tunnelService?.username || 'none'}, cookie=${req.headers.cookie ? 'present' : 'MISSING'}`);

  return res.json({
    authenticated,
    user: tunnelService ? {
      username: tunnelService.username,
      email: tunnelService.email,
      userSubdomain: tunnelService.userSubdomain,
      plan: tunnelService.plan || 'free',
    } : null,
    oauthUrl,
  });
});

router.post('/refresh-plan', async (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  if (!tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const meRes = await fetch(`${config.tunnelServiceUrl}/api/users/me`, {
      headers: { 'Authorization': `users API-Key ${tunnelService.apiKey}` },
    });

    if (!meRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch plan from tunnel-service' });
    }

    const meData = await meRes.json() as { user?: { plan?: string } };
    const plan: 'free' | 'pro' = meData.user?.plan === 'pro' ? 'pro' : 'free';

    req.session.tunnelService!.plan = plan;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    res.json({ plan });
  } catch (err: any) {
    console.error('[auth] Failed to refresh plan:', err);
    res.status(500).json({ error: 'Failed to refresh plan' });
  }
});

export default router;
