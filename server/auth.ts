import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import type { IncomingMessage } from 'http';
import config from './config.ts';
import '../shared/types/server.ts'; // session augmentation

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Dev escape hatch
  if (config.nodeEnv === 'development' && process.env.DEV_SKIP_AUTH === 'true') {
    next();
    return;
  }

  // Whitelisted paths (accessible without OAuth)
  const whitelistedPaths = [
    '/api/auth/status',
    '/api/auth/logout',
    '/api/tunnel-auth/callback',
    '/api/tunnel-auth/connect',
    '/api/tunnel-auth/restore',
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
