import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

router.post('/logout', (req: Request, res: Response) => {
  console.log('[auth] Logout requested');

  // Clear cached user info immediately so auto-bootstrap stops re-authenticating
  tunnelManager.clearUserInfo();

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    console.log('[auth] Session destroyed');

    // Send the response FIRST, then disconnect the tunnel after a short delay
    // so the response can travel back through the WebSocket before it closes.
    res.json({ success: true });

    setTimeout(() => {
      console.log('[auth] Disconnecting tunnel after logout');
      tunnelManager.clearCredentials();
    }, 1000);
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
    } : null,
    oauthUrl,
  });
});

export default router;
