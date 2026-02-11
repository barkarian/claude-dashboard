import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import type { IncomingMessage } from 'http';
import config from './config.ts';
import '../shared/types/server.ts'; // session augmentation

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/api/auth/login' || req.path === '/api/auth/status') {
    next();
    return;
  }

  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  if (req.session && req.session.authenticated) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!config.passwordHash) {
    return true;
  }
  return bcrypt.compare(password, config.passwordHash);
}

export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const session = (socket.request as IncomingMessage & { session?: { authenticated?: boolean } }).session;
  if (session && session.authenticated) {
    next();
    return;
  }
  if (!config.passwordHash) {
    next();
    return;
  }
  next(new Error('Unauthorized'));
}
