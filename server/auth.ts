import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import config from './config.ts';
import tunnelManager from './services/tunnelManager.ts';
import '../shared/types/server.ts'; // session augmentation

/**
 * Check if a request is coming through the tunnel (X-Forwarded-Host matches tunnel domain).
 */
function isRequestViaTunnel(req: Request): boolean {
  const forwardedHost = req.get('X-Forwarded-Host');
  return !!(forwardedHost && config.tunnelDomain && forwardedHost.endsWith(config.tunnelDomain));
}

/**
 * Auto-bootstrap session for requests arriving through the authenticated tunnel.
 *
 * When a user completes OAuth on localhost, the session cookie is set on localhost.
 * When the browser is then redirected to the tunnel URL (e.g. barkarian-2.claw-dev.com),
 * there's no cookie for that domain. Instead of forcing a second OAuth loop, we check:
 *   1. The request came through the tunnel (X-Forwarded-Host)
 *   2. The tunnel is authenticated (tunnelManager has credentials + user info)
 * If true, we auto-create the session. This is safe because the tunnel WebSocket
 * itself required API key authentication.
 *
 * Returns true if session now has tunnelService data (either existing or freshly bootstrapped).
 */
function tryAutoBootstrapSession(req: Request): boolean {
  if (!req.session) return false;
  if (req.session.tunnelService) return true; // already has session

  // Check for cryptographic tunnel token (injected by tunnel service)
  const tunnelToken = req.get('X-Tunnel-Token');
  if (!tunnelToken) {
    // Fallback: also accept X-Forwarded-Host for backwards compatibility during migration
    if (!isRequestViaTunnel(req)) return false;

    const userInfo = tunnelManager.getUserInfo();
    if (!userInfo) return false;

    req.session.tunnelService = {
      apiKey: userInfo.apiKey,
      userSubdomain: userInfo.userSubdomain,
      userId: userInfo.userId,
      email: userInfo.email,
      username: userInfo.username,
      plan: userInfo.plan || 'free',
    };

    req.session.save((err) => {
      if (err) console.error('[auth] Failed to save auto-bootstrapped session:', err);
    });

    console.log(`[auth] Auto-bootstrapped session via X-Forwarded-Host (user=${userInfo.username})`);
    return true;
  }

  // Validate the HMAC token
  const userInfo = tunnelManager.getUserInfo();
  if (!userInfo || !userInfo.apiKey) return false;

  // Token format: timestamp.hmac
  const dotIndex = tunnelToken.indexOf('.');
  if (dotIndex === -1) return false;
  const timestamp = tunnelToken.slice(0, dotIndex);
  const signature = tunnelToken.slice(dotIndex + 1);
  if (!timestamp || !signature) return false;

  // Reject tokens older than 5 minutes
  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age > 300000 || age < -30000) return false;

  // Verify HMAC
  const expected = crypto.createHmac('sha256', userInfo.apiKey)
    .update(timestamp + '.' + userInfo.userSubdomain)
    .digest('hex');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      return false;
    }
  } catch {
    return false; // invalid hex
  }

  // Token valid — bootstrap session
  req.session.tunnelService = {
    apiKey: userInfo.apiKey,
    userSubdomain: userInfo.userSubdomain,
    userId: userInfo.userId,
    email: userInfo.email,
    username: userInfo.username,
    plan: userInfo.plan || 'free',
  };

  req.session.save((err) => {
    if (err) console.error('[auth] Failed to save token-bootstrapped session:', err);
  });

  console.log(`[auth] Auto-bootstrapped session via X-Tunnel-Token (user=${userInfo.username})`);
  return true;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Dev escape hatch
  if (config.nodeEnv === 'development' && process.env.DEV_SKIP_AUTH === 'true') {
    next();
    return;
  }

  // Auto-bootstrap session for tunnel-proxied requests FIRST,
  // before any whitelist or auth checks, so that even whitelisted endpoints
  // like /api/auth/status see the bootstrapped session data.
  tryAutoBootstrapSession(req);

  // Strip env prefix before checking whitelisted paths
  const envPrefix = `/${config.dashboardEnv}`;
  const pathToCheck = req.path.startsWith(envPrefix + '/')
    ? req.path.slice(envPrefix.length)
    : req.path;

  // Whitelisted paths (accessible without OAuth)
  const whitelistedPaths = [
    '/api/auth/status',
    '/api/auth/logout',
    '/api/tunnel-auth/callback',
    '/api/tunnel-auth/connect',
    '/api/tunnel-auth/activate',
  ];

  if (whitelistedPaths.includes(pathToCheck)) {
    next();
    return;
  }

  // Check OAuth session
  if (req.session && req.session.tunnelService) {
    next();
    return;
  }

  // Build OAuth URL for redirect (env-prefixed)
  const oauthUrl = config.tunnelMode === 'tunnel-service' && config.tunnelServiceUrl
    ? `/${config.dashboardEnv}/api/tunnel-auth/connect`
    : null;

  // API routes: return 401 JSON
  if (pathToCheck.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized — OAuth required', oauthUrl });
    return;
  }

  // Non-API routes (production static files): redirect to OAuth
  if (oauthUrl) {
    res.redirect(oauthUrl);
    return;
  }

  res.status(401).send('Unauthorized — tunnel service not configured');
}

export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  // Dev escape hatch
  if (config.nodeEnv === 'development' && process.env.DEV_SKIP_AUTH === 'true') {
    next();
    return;
  }

  const session = (socket.request as IncomingMessage & { session?: { tunnelService?: unknown } }).session;
  if (session && session.tunnelService) {
    next();
    return;
  }
  next(new Error('Unauthorized'));
}
