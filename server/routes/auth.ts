import { Router, type Request, type Response } from 'express';
import { verifyPassword } from '../auth.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const valid = await verifyPassword(password);

    if (valid) {
      req.session.authenticated = true;
      return res.json({ success: true });
    }

    return res.status(401).json({ error: 'Invalid password' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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
  const authenticated = !!(req.session && req.session.authenticated);
  return res.json({ authenticated });
});

export default router;
