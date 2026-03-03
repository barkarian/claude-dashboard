import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';
import * as tunnelClient from '../services/tunnelClient.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

// Pending activation data for account switches (short-lived, used by /activate)
let pendingActivation: { apiKey: string; userSubdomain: string; timestamp: number } | null = null;

// GET /api/tunnel-auth/connect — redirect browser to tunnel-service OAuth
router.get('/connect', (req: Request, res: Response) => {
  console.log('[tunnel-auth] /connect hit');
  if (config.tunnelMode !== 'tunnel-service' || !config.tunnelServiceUrl) {
    console.log('[tunnel-auth] Tunnel service not configured, returning 400');
    return res.status(400).json({ error: 'Tunnel service not configured' });
  }

  // Use forwarded host (tunnel) or request host (localhost) for dynamic callback
  const forwardedHost = req.get('X-Forwarded-Host');
  const protocol = req.get('X-Forwarded-Proto') || req.protocol;
  const host = forwardedHost || req.get('host') || `localhost:${config.port}`;
  const callbackUrl = `${protocol}://${host}/${config.dashboardEnv}/api/tunnel-auth/callback`;

  console.log(`[tunnel-auth] Redirecting to OAuth. callbackUrl=${callbackUrl}, forwardedHost=${forwardedHost}, host=${host}`);

  const authorizeUrl = `${config.tunnelServiceUrl}/oauth/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&client_id=claude-dashboard`;

  res.redirect(authorizeUrl);
});

// GET /api/tunnel-auth/callback — receive auth code from tunnel-service OAuth
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  console.log(`[tunnel-auth] /callback hit. code=${code ? code.slice(0, 8) + '...' : 'MISSING'}`);

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  if (!config.tunnelServiceUrl) {
    return res.status(400).send('Tunnel service not configured');
  }

  try {
    // Exchange code for credentials
    console.log(`[tunnel-auth] Exchanging code for token at ${config.tunnelServiceUrl}/oauth/token`);
    const tokenRes = await fetch(`${config.tunnelServiceUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    console.log(`[tunnel-auth] Token exchange response: ${tokenRes.status} ${tokenRes.statusText}`);

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({ error: 'Token exchange failed' }));
      console.error('[tunnel-auth] Token exchange failed:', err);
      return res.status(400).send(`OAuth error: ${(err as any).error || 'Unknown error'}`);
    }

    const data = await tokenRes.json() as {
      user: { id: string; email: string; username: string; userSubdomain: string };
      apiKey: string;
    };

    console.log(`[tunnel-auth] Token exchange success. user=${data.user?.username}, subdomain=${data.user?.userSubdomain}, apiKey=${data.apiKey ? data.apiKey.slice(0, 8) + '...' : 'MISSING'}`);

    if (!data.apiKey) {
      console.error('[tunnel-auth] No API key in token response');
      return res.status(400).send('No API key returned. Please enable API key in your tunnel-service account.');
    }

    // Fetch the user's plan from tunnel-service
    let plan: 'free' | 'pro' = 'free';
    try {
      const meRes = await fetch(`${config.tunnelServiceUrl}/api/users/me`, {
        headers: { 'Authorization': `users API-Key ${data.apiKey}` },
      });
      if (meRes.ok) {
        const meData = await meRes.json() as { user?: { plan?: string } };
        if (meData.user?.plan === 'pro') plan = 'pro';
      }
    } catch { /* default to free */ }

    // Store credentials in session
    const userInfo = {
      apiKey: data.apiKey,
      userSubdomain: data.user.userSubdomain,
      userId: data.user.id,
      email: data.user.email,
      username: data.user.username,
      plan,
    };
    req.session.tunnelService = userInfo;
    console.log(`[tunnel-auth] Session stored for user=${data.user.username}`);

    // Cache user info server-side so tunnel-proxied requests can auto-bootstrap sessions
    tunnelManager.setUserInfo(userInfo);

    // Check if the subdomain is changing (account switch)
    const currentCreds = tunnelManager.getCredentials();
    const isSubdomainChange = currentCreds && currentCreds.userSubdomain !== data.user.userSubdomain;

    if (isSubdomainChange) {
      // Account switch: the callback response must travel back through the OLD tunnel.
      // We can't close the old WebSocket yet. Instead:
      // 1. Redirect to localhost /api/tunnel-auth/activate (response goes through old tunnel safely)
      // 2. The /activate endpoint (hit directly on localhost) switches the tunnel and redirects to the new URL
      console.log(`[tunnel-auth] Subdomain changing from ${currentCreds.userSubdomain} to ${data.user.userSubdomain} — redirecting to localhost /activate`);

      // Store pending activation data so /activate can pick it up
      pendingActivation = {
        apiKey: data.apiKey,
        userSubdomain: data.user.userSubdomain,
        timestamp: Date.now(),
      };

      // Save session
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });

      // Redirect to localhost /activate — browser hits this directly, not through tunnel
      res.redirect(`http://localhost:${config.port}/api/tunnel-auth/activate`);
    } else {
      // Same subdomain or fresh tunnel — switch immediately
      console.log('[tunnel-auth] Setting tunnel credentials and waiting for connection...');
      tunnelManager.setCredentials(data.apiKey, data.user.userSubdomain);

      // Wait for tunnel WebSocket to connect before redirecting (up to 5s)
      const maxWait = 5000;
      const pollInterval = 200;
      let waited = 0;
      while (!tunnelClient.isConnected() && waited < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        waited += pollInterval;
      }
      console.log(`[tunnel-auth] Tunnel connected=${tunnelClient.isConnected()} after ${waited}ms`);

      // Save session before redirect
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error('[tunnel-auth] Failed to save session:', err);
            reject(err);
          } else {
            console.log('[tunnel-auth] Session saved successfully');
            resolve();
          }
        });
      });

      // Redirect to the tunnel URL (env-prefixed)
      let redirectUrl: string;
      if (config.tunnelDomain) {
        redirectUrl = `https://${data.user.userSubdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`;
      } else {
        redirectUrl = config.nodeEnv === 'development' ? 'http://localhost:5173' : '/';
      }

      console.log(`[tunnel-auth] Redirecting to ${redirectUrl}`);
      res.redirect(redirectUrl);
    }
  } catch (err) {
    console.error('[tunnel-auth] OAuth callback error:', err);
    res.status(500).send('Failed to complete OAuth flow');
  }
});

// GET /api/tunnel-auth/activate — phase 2 of account switch: switch tunnel, then redirect to new URL
// This endpoint is hit directly on localhost (not through tunnel) after the callback redirect.
router.get('/activate', async (req: Request, res: Response) => {
  console.log('[tunnel-auth] /activate hit');

  if (!pendingActivation) {
    console.error('[tunnel-auth] /activate called but no pending activation');
    return res.status(400).send('No pending account switch');
  }

  // Check staleness (expire after 30s)
  if (Date.now() - pendingActivation.timestamp > 30000) {
    console.error('[tunnel-auth] Pending activation expired');
    pendingActivation = null;
    return res.status(400).send('Account switch expired, please try again');
  }

  const { apiKey, userSubdomain } = pendingActivation;
  pendingActivation = null; // consume it

  console.log(`[tunnel-auth] Activating tunnel for subdomain=${userSubdomain}`);

  // Switch the tunnel to the new account
  tunnelManager.resetEndpointCache();
  tunnelManager.setCredentials(apiKey, userSubdomain);

  // Wait for the new tunnel WebSocket to connect (up to 8s)
  const maxWait = 8000;
  const pollInterval = 200;
  let waited = 0;
  while (!tunnelClient.isConnected() && waited < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }
  console.log(`[tunnel-auth] New tunnel connected=${tunnelClient.isConnected()} after ${waited}ms`);

  // Build the new tunnel URL (env-prefixed)
  let redirectUrl: string;
  if (config.tunnelDomain) {
    redirectUrl = `https://${userSubdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`;
  } else {
    redirectUrl = config.nodeEnv === 'development' ? 'http://localhost:5173' : '/';
  }

  console.log(`[tunnel-auth] Account switch complete, redirecting to ${redirectUrl}`);
  res.redirect(redirectUrl);
});

// GET /api/tunnel-auth/status — check if tunnel service is connected
router.get('/status', (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  const wsConnected = tunnelClient.isConnected();
  const creds = tunnelManager.getCredentials();

  console.log(`[tunnel-auth] /status check: session=${!!tunnelService}, wsConnected=${wsConnected}, hasCreds=${!!creds}, sessionUser=${tunnelService?.username || 'none'}`);

  res.json({
    connected: !!tunnelService,
    tunnelMode: config.tunnelMode,
    tunnelServiceUrl: config.tunnelServiceUrl,
    wsConnected,
    user: tunnelService ? {
      username: tunnelService.username,
      email: tunnelService.email,
      userSubdomain: tunnelService.userSubdomain,
    } : null,
  });
});

// GET /api/tunnel-auth/modes — which modes (local/vps) are connected for this user
router.get('/modes', async (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  if (!tunnelService || !config.tunnelServiceUrl) {
    return res.json({ modes: [] });
  }

  try {
    const modesRes = await fetch(
      `${config.tunnelServiceUrl}/api/tunnel/modes/${tunnelService.userSubdomain}`,
      { headers: { 'Authorization': `users API-Key ${tunnelService.apiKey}` } },
    );
    if (modesRes.ok) {
      const data = await modesRes.json() as { modes: string[] };
      return res.json({ modes: data.modes });
    }
  } catch { /* fall through */ }

  res.json({ modes: [] });
});

// POST /api/tunnel-auth/disconnect — destroy user session (tunnel stays open for re-login)
router.post('/disconnect', (req: Request, res: Response) => {
  console.log('[tunnel-auth] /disconnect hit');
  tunnelManager.clearUserInfo();
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to disconnect' });
    }
    res.clearCookie(`connect.sid.${config.dashboardEnv}`);
    console.log('[tunnel-auth] Session destroyed, user info cleared (tunnel stays open)');
    return res.json({ success: true });
  });
});

export default router;
