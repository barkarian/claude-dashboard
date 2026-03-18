import { Router, type Request, type Response } from 'express';
import config from '../config.ts';
import tunnelManager from '../services/tunnelManager.ts';

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
    res.clearCookie(`connect.sid.${config.dashboardEnv}`);

    // Clear the gate cookie so the browser is fully logged out
    const tunnelDomain = config.tunnelDomain;
    if (tunnelDomain) {
      res.setHeader('Set-Cookie', `claw-gate=; Domain=.${tunnelDomain}; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    }

    console.log('[auth] Session destroyed, user info + gate cookie cleared (tunnel stays open for re-login)');
    return res.json({ success: true });
  });
});

router.get('/status', (req: Request, res: Response) => {
  const tunnelService = req.session?.tunnelService;
  const creds = tunnelManager.getCredentials();
  const tunnelConnected = !!creds?.userSubdomain && config.tunnelDomain;

  // Desktop mode detection: the server has CLAW_DESKTOP=1 (set by Tauri sidecar),
  // but we also need to distinguish the Tauri webview (direct localhost access)
  // from mobile/browser users (who access through the tunnel proxy).
  //
  // Tunnel-proxied requests have X-Forwarded-Host set by the proxy. Direct
  // requests to localhost:2222 from the Tauri webview do NOT have this header.
  // So: isDesktop = CLAW_DESKTOP=1 AND no tunnel proxy (direct access).
  //
  // This replaces the old client-side isOnLocalhost() check which was unreliable
  // because window.__TAURI__ is unavailable when loading http://localhost content.
  const isDesktopServer = process.env.CLAW_DESKTOP === '1';
  const isDirectAccess = !req.get('X-Forwarded-Host');
  const isDesktop = isDesktopServer && isDirectAccess;

  console.log(`[auth] /status desktop detection: CLAW_DESKTOP=${process.env.CLAW_DESKTOP}, X-Forwarded-Host=${req.get('X-Forwarded-Host') || 'none'}, isDesktop=${isDesktop}`);

  if (isDesktopServer) {
    const userInfo = tunnelManager.getUserInfo();
    const subdomain = userInfo?.userSubdomain || creds?.userSubdomain;
    const tunnelUrl = subdomain && config.tunnelDomain
      ? `https://${subdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`
      : null;

    // Only report authenticated if we have real user info or persisted
    // credentials (which means the tunnel is connected or connecting).
    // Without either, the user needs to go through the OAuth flow to
    // connect the tunnel — returning a fake "desktop" user would trap
    // them in a logged-in state with no way to actually use the app.
    const hasRealUser = !!(userInfo || creds);

    // Provide the OAuth URL when not authenticated so the login screen
    // can show the "Connect" button.
    const oauthUrl = !hasRealUser && config.tunnelMode === 'tunnel-service' && config.tunnelServiceUrl
      ? `/api/tunnel-auth/connect`
      : null;

    return res.json({
      authenticated: hasRealUser,
      isDesktop,  // true only for direct localhost access (Tauri webview), false for tunnel-proxied (mobile/browser)
      isVps: false,
      dashboardEnv: config.dashboardEnv,
      user: userInfo ? {
        username: userInfo.username,
        email: userInfo.email,
        userSubdomain: userInfo.userSubdomain,
        plan: userInfo.plan || 'free',
      } : null,
      oauthUrl,
      tunnelUrl,
    });
  }

  const authenticated = !!tunnelService;

  // Only offer OAuth if the tunnel isn't already connected
  const oauthUrl = !tunnelConnected && config.tunnelMode === 'tunnel-service' && config.tunnelServiceUrl
    ? `/${config.dashboardEnv}/api/tunnel-auth/connect`
    : null;

  const sessionId = req.sessionID ? req.sessionID.slice(0, 8) + '...' : 'none';
  console.log(`[auth] /status check: authenticated=${authenticated}, tunnelConnected=${tunnelConnected}, sessionId=${sessionId}, user=${tunnelService?.username || 'none'}, cookie=${req.headers.cookie ? 'present' : 'MISSING'}`);

  // Build tunnel URL for localhost→tunnel redirect
  // Use session subdomain if available, otherwise fall back to server-side credentials
  const subdomain = tunnelService?.userSubdomain || creds?.userSubdomain;
  const tunnelUrl = subdomain && config.tunnelDomain
    ? `https://${subdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`
    : null;

  return res.json({
    authenticated,
    isDesktop: false,
    isVps: config.isVps,
    dashboardEnv: config.dashboardEnv,
    user: tunnelService ? {
      username: tunnelService.username,
      email: tunnelService.email,
      userSubdomain: tunnelService.userSubdomain,
      plan: tunnelService.plan || 'free',
    } : null,
    oauthUrl,
    tunnelUrl,
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
