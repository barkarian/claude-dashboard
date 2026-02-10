import bcrypt from 'bcrypt';
import config from './config.js';

export function authMiddleware(req, res, next) {
  if (req.path === '/api/auth/login' || req.path === '/api/auth/status') {
    return next();
  }

  if (!req.path.startsWith('/api/')) {
    return next();
  }

  if (req.session && req.session.authenticated) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

export async function verifyPassword(password) {
  if (!config.passwordHash) {
    return true;
  }
  return bcrypt.compare(password, config.passwordHash);
}

export function socketAuthMiddleware(socket, next) {
  const session = socket.request.session;
  if (session && session.authenticated) {
    return next();
  }
  if (!config.passwordHash) {
    return next();
  }
  return next(new Error('Unauthorized'));
}
