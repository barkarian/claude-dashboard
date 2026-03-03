import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import billingService from '../services/billingService.ts';
import '../../shared/types/server.ts';

const router = Router();

// GET /api/billing/config
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const data = await billingService.getBillingConfig();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch billing config' });
  }
});

// POST /api/billing/create-checkout
router.post('/create-checkout', async (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  if (!tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Build success/cancel URLs pointing back to the dashboard
    let baseUrl: string;
    if (tunnelService.userSubdomain && config.tunnelDomain) {
      baseUrl = `https://${tunnelService.userSubdomain}.${config.tunnelDomain}`;
    } else {
      const protocol = req.get('X-Forwarded-Proto') || req.protocol;
      const host = req.get('X-Forwarded-Host') || req.get('host') || `localhost:${config.port}`;
      baseUrl = `${protocol}://${host}`;
    }

    const successUrl = `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/billing/cancel`;

    const data = await billingService.createCheckout(successUrl, cancelUrl);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create checkout' });
  }
});

// POST /api/billing/customer-portal
router.post('/customer-portal', async (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  if (!tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    let returnUrl: string;
    if (tunnelService.userSubdomain && config.tunnelDomain) {
      returnUrl = `https://${tunnelService.userSubdomain}.${config.tunnelDomain}/settings`;
    } else {
      const protocol = req.get('X-Forwarded-Proto') || req.protocol;
      const host = req.get('X-Forwarded-Host') || req.get('host') || `localhost:${config.port}`;
      returnUrl = `${protocol}://${host}/settings`;
    }

    const data = await billingService.createCustomerPortal(returnUrl);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create customer portal session' });
  }
});

// POST /api/billing/dev-upgrade
router.post('/dev-upgrade', async (req: Request, res: Response) => {
  if (!req.session?.tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const data = await billingService.devUpgrade();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to upgrade' });
  }
});

// POST /api/billing/dev-downgrade
router.post('/dev-downgrade', async (req: Request, res: Response) => {
  if (!req.session?.tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const data = await billingService.devDowngrade();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to downgrade' });
  }
});

// GET /api/billing/vps-status
router.get('/vps-status', async (req: Request, res: Response) => {
  if (!req.session?.tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const data = await billingService.getVpsStatus();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get VPS status' });
  }
});

// POST /api/billing/vps-provision
router.post('/vps-provision', async (req: Request, res: Response) => {
  if (!req.session?.tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const data = await billingService.provisionVps();
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to provision VPS' });
  }
});

// DELETE /api/billing/vps-destroy
router.delete('/vps-destroy', async (req: Request, res: Response) => {
  if (!req.session?.tunnelService) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const data = await billingService.destroyVps();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to destroy VPS' });
  }
});

export default router;
