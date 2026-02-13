import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

router.get('/status', (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  const authenticated = !!tunnelService;

  const oauthUrl = config.tunnelMode === 'tunnel-service' && config.tunnelServiceUrl
    ? '/api/tunnel-auth/connect'
    : null;

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
