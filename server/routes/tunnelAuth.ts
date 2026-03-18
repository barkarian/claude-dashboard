import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';
import * as tunnelClient from '../services/tunnelClient.ts';

const router = Router();

// Pending activation data for account switches (short-lived, used by /activate)
let pendingActivation: { apiKey: string; userSubdomain: string; gateToken?: string; timestamp: number } | null = null;

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

  // Generate OAuth state parameter to prevent login CSRF
  const state = crypto.randomBytes(16).toString('hex');

  console.log(`[tunnel-auth] Redirecting to OAuth. callbackUrl=${callbackUrl}, forwardedHost=${forwardedHost}, host=${host}`);

  const authorizeUrl = `${config.tunnelServiceUrl}/oauth/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&client_id=claude-dashboard&state=${encodeURIComponent(state)}`;

  // Store state in session and save before redirect
  // Guard: req.session may not exist yet if saveUninitialized is false
  if (!req.session) {
    return res.redirect(authorizeUrl);
  }
  req.session.oauthState = state;
  req.session.save((err) => {
    if (err) {
      console.error('[tunnel-auth] Failed to save session with OAuth state:', err);
      // Still redirect — state validation will fail on callback but user can retry
      return res.redirect(authorizeUrl);
    }
    res.redirect(authorizeUrl);
  });
});

// GET /api/tunnel-auth/callback — receive auth code from tunnel-service OAuth
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  console.log(`[tunnel-auth] /callback hit. code=${code ? code.slice(0, 8) + '...' : 'MISSING'}`);

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Validate OAuth state parameter
  if (!state || !req.session?.oauthState || state !== req.session.oauthState) {
    console.error(`[tunnel-auth] OAuth state mismatch: expected=${req.session?.oauthState}, got=${state}`);
    return res.status(400).send('OAuth state mismatch — possible CSRF attack. Please try again.');
  }
  delete req.session.oauthState;

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
      gateToken?: string;
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
        gateToken: data.gateToken,
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

      // Desktop mode (Tauri webview): redirect back to localhost so the webview
      // stays on localhost. This is critical because isDesktop detection on the
      // client combines the server's CLAW_DESKTOP flag with an isOnLocalhost()
      // check — if we redirected to the tunnel URL, the webview would be on a
      // tunnel hostname and isDesktop would be false, hiding desktop-only UI.
      // The tunnel is still connected in the background for mobile/browser access.
      let redirectUrl: string;
      if (process.env.CLAW_DESKTOP === '1') {
        redirectUrl = `http://localhost:${config.port}/`;
        console.log('[tunnel-auth] Desktop mode: redirecting to localhost instead of tunnel URL');
      } else if (config.tunnelDomain) {
        const tunnelUrl = `https://${data.user.userSubdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`;
        if (data.gateToken && config.tunnelServiceUrl) {
          // Redirect through gate/activate to set the gate cookie in one step
          const apiSubdomain = process.env.API_SUBDOMAIN || 'tunnel-api';
          redirectUrl = `https://${apiSubdomain}.${config.tunnelDomain}/gate/activate?token=${encodeURIComponent(data.gateToken)}&redirect=${encodeURIComponent(tunnelUrl)}`;
        } else {
          redirectUrl = tunnelUrl;
        }
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

  const { apiKey, userSubdomain, gateToken } = pendingActivation;
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

  // Desktop mode: same as callback — stay on localhost so isDesktop detection works.
  let redirectUrl: string;
  if (process.env.CLAW_DESKTOP === '1') {
    redirectUrl = `http://localhost:${config.port}/`;
    console.log('[tunnel-auth] Desktop mode: account switch redirecting to localhost');
  } else if (config.tunnelDomain) {
    const tunnelUrl = `https://${userSubdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`;
    if (gateToken && config.tunnelServiceUrl) {
      const apiSubdomain = process.env.API_SUBDOMAIN || 'tunnel-api';
      redirectUrl = `https://${apiSubdomain}.${config.tunnelDomain}/gate/activate?token=${encodeURIComponent(gateToken)}&redirect=${encodeURIComponent(tunnelUrl)}`;
    } else {
      redirectUrl = tunnelUrl;
    }
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

// POST /api/tunnel-auth/disconnect — full teardown for desktop app logout.
// Deactivates all tunnel endpoints on the tunnel service, disconnects the
// WebSocket, wipes cached user info and persisted SQLite credentials, and
// destroys the Express session.  The next app launch will require a fresh
// login and tunnel connection.
//
// IMPORTANT: The disconnect request typically arrives through the tunnel
// WebSocket (the Tauri webview is on a tunnel URL after OAuth). We must
// send the JSON response BEFORE tearing down the WebSocket, otherwise the
// response can never travel back to the client. The actual teardown is
// scheduled on a short delay after the response is flushed.
router.post('/disconnect', (req: Request, res: Response) => {
  console.log('[tunnel-auth] /disconnect hit — scheduling full teardown');

  // Destroy session best-effort (cookie may not be present if cross-origin).
  try {
    if (req.session) {
      req.session.destroy(() => {});
    }
  } catch {
    // Ignore — session may already be gone
  }
  res.clearCookie(`connect.sid.${config.dashboardEnv}`);

  // Send response immediately so it travels back through the tunnel WebSocket.
  res.json({ success: true });

  // Delay the actual teardown so the response has time to reach the client
  // before we disconnect the WebSocket that carries it.
  setTimeout(async () => {
    console.log('[tunnel-auth] Executing delayed teardown');
    // 1. Deactivate all tunnel-service endpoints BEFORE clearing credentials,
    //    because the deactivation call needs the API key that clearCredentials wipes.
    await tunnelManager.deactivateAllEndpoints();
    // 2. Clear cached user info so auto-bootstrap stops re-authenticating requests.
    tunnelManager.clearUserInfo();
    // 3. Clear credentials: nulls API key, disconnects WebSocket, deletes
    //    SQLite tunnel_credentials row (local mode).
    tunnelManager.clearCredentials();
    console.log('[tunnel-auth] Full teardown complete: endpoints deactivated, tunnel closed, credentials wiped');
  }, 500);
});

export default router;
