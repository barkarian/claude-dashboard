import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';
import * as tunnelClient from '../services/tunnelClient.ts';
import '../../shared/types/server.ts'; // session augmentation

const router = Router();

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
  const callbackUrl = `${protocol}://${host}/api/tunnel-auth/callback`;

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

    // Store credentials in session
    const userInfo = {
      apiKey: data.apiKey,
      userSubdomain: data.user.userSubdomain,
      userId: data.user.id,
      email: data.user.email,
      username: data.user.username,
    };
    req.session.tunnelService = userInfo;
    console.log(`[tunnel-auth] Session stored for user=${data.user.username}`);

    // Cache user info server-side so tunnel-proxied requests can auto-bootstrap sessions
    tunnelManager.setUserInfo(userInfo);

    // Bootstrap tunnel with OAuth credentials (always update — fresh OAuth key takes priority)
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

    // Always redirect to the tunnel URL — the auth middleware will auto-bootstrap
    // the session for tunnel-proxied requests using the cached user info.
    let redirectUrl: string;
    if (config.tunnelDomain) {
      redirectUrl = `https://${data.user.userSubdomain}.${config.tunnelDomain}`;
    } else {
      redirectUrl = config.nodeEnv === 'development' ? 'http://localhost:5173' : '/';
    }

    console.log(`[tunnel-auth] Redirecting to ${redirectUrl}`);
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[tunnel-auth] OAuth callback error:', err);
    res.status(500).send('Failed to complete OAuth flow');
  }
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

// POST /api/tunnel-auth/disconnect — destroy user session (tunnel is server-level)
router.post('/disconnect', (req: Request, res: Response) => {
  console.log('[tunnel-auth] /disconnect hit');
  tunnelManager.clearUserInfo();
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to disconnect' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });

    setTimeout(() => {
      console.log('[tunnel-auth] Disconnecting tunnel after disconnect');
      tunnelManager.clearCredentials();
    }, 1000);
  });
});

export default router;
