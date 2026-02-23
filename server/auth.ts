import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import type { IncomingMessage } from 'http';
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
  if (req.session?.tunnelService) return true; // already has session

  if (!isRequestViaTunnel(req)) return false;

  const userInfo = tunnelManager.getUserInfo();
  if (!userInfo) return false;

  // Auto-bootstrap the session with cached user info
  req.session.tunnelService = {
    apiKey: userInfo.apiKey,
    userSubdomain: userInfo.userSubdomain,
    userId: userInfo.userId,
    email: userInfo.email,
    username: userInfo.username,
  };

  // Explicitly save so the session persists (saveUninitialized: false won't auto-save)
  req.session.save((err) => {
    if (err) {
      console.error('[auth] Failed to save auto-bootstrapped session:', err);
    }
  });

  console.log(`[auth] Auto-bootstrapped session for tunnel request (user=${userInfo.username}, host=${req.get('X-Forwarded-Host')})`);
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

  // Whitelisted paths (accessible without OAuth)
  const whitelistedPaths = [
    '/api/auth/status',
    '/api/auth/logout',
    '/api/tunnel-auth/callback',
    '/api/tunnel-auth/connect',
    '/api/tunnel-auth/activate',
  ];

  if (whitelistedPaths.includes(req.path)) {
    next();
    return;
  }

  // Check OAuth session
  if (req.session && req.session.tunnelService) {
    next();
    return;
  }

  // Build OAuth URL for redirect
  const oauthUrl = config.tunnelMode === 'tunnel-service' && config.tunnelServiceUrl
    ? '/api/tunnel-auth/connect'
    : null;

  // API routes: return 401 JSON
  if (req.path.startsWith('/api/')) {
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
