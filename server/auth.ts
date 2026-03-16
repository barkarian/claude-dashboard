import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import type { IncomingMessage } from 'http';
import config from './config.ts';
import tunnelManager from './services/tunnelManager.ts';
import * as tunnelClient from './services/tunnelClient.ts';
import '../shared/types/server.ts'; // session augmentation

/**
 * Validate tunnel session token using timing-safe comparison.
 * Replaces the old X-Forwarded-Host trust approach with a cryptographic token
 * generated during WebSocket authentication.
 */
function validateTunnelToken(req: Request): boolean {
  const token = req.headers['x-tunnel-token'];
  if (!token || typeof token !== 'string') return false;

  const expectedToken = tunnelClient.getSessionToken();
  if (!expectedToken) return false;

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expectedToken),
    );
  } catch {
    return false; // different lengths
  }
}

/**
 * Auto-bootstrap session for requests arriving through the authenticated tunnel.
 *
 * When a request arrives with a valid X-Tunnel-Token (injected by the tunnel proxy),
 * and there's no session yet, we auto-create one from cached user info.
 * This is safe because the token is generated per-connection during WebSocket auth.
 *
 * Returns true if session now has tunnelService data (either existing or freshly bootstrapped).
 */
function tryAutoBootstrapSession(req: Request): boolean {
  if (!req.session) return false;
  if (req.session.tunnelService) return true; // already has session

  if (!validateTunnelToken(req)) return false;

  const userInfo = tunnelManager.getUserInfo();
  if (!userInfo) return false;

  // Auto-bootstrap the session with cached user info
  req.session.tunnelService = {
    apiKey: userInfo.apiKey,
    userSubdomain: userInfo.userSubdomain,
    userId: userInfo.userId,
    email: userInfo.email,
    username: userInfo.username,
    plan: userInfo.plan || 'free',
  };

  // Explicitly save so the session persists (saveUninitialized: false won't auto-save)
  req.session.save((err) => {
    if (err) {
      console.error('[auth] Failed to save auto-bootstrapped session:', err);
    }
  });

  console.log(`[auth] Auto-bootstrapped session via tunnel token (user=${userInfo.username})`);
  return true;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Dev escape hatch
  if (config.nodeEnv === 'development' && process.env.DEV_SKIP_AUTH === 'true') {
    next();
    return;
  }

  // Desktop mode: skip auth for localhost (no remote access possible)
  if (process.env.CLAW_DESKTOP === '1') {
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

  // If tunnel is already connected server-side, redirect to tunnel URL
  // (gate auth on the tunnel proxy will handle browser-level login)
  const creds = tunnelManager.getCredentials();
  if (creds?.userSubdomain && config.tunnelDomain) {
    const tunnelUrl = `https://${creds.userSubdomain}.${config.tunnelDomain}/${config.dashboardEnv}/`;

    if (pathToCheck.startsWith('/api/')) {
      res.status(401).json({ error: 'Unauthorized', tunnelUrl });
      return;
    }

    res.redirect(tunnelUrl);
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

  // Desktop mode: skip auth for localhost
  if (process.env.CLAW_DESKTOP === '1') {
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
