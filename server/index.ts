import fs from 'fs';
import http from 'http';
import path from 'path';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import config from './config.ts';
import { authMiddleware, socketAuthMiddleware } from './auth.ts';
import authRoutes from './routes/auth.ts';
import projectRoutes from './routes/projects.ts';
import scriptRoutes from './routes/scripts.ts';
import githubRoutes from './routes/github.ts';
import tunnelAuthRoutes from './routes/tunnelAuth.ts';
import settingsRoutes from './routes/settings.ts';
import billingRoutes from './routes/billing.ts';
import migrateRoutes from './routes/migrate.ts';
import registerSocketHandlers from './sockets/index.ts';
import processManager from './services/processManager.ts';
import tunnelManager from './services/tunnelManager.ts';
import sshKeyService from './services/sshKeyService.ts';
import credentialService from './services/credentialService.ts';
import sdkSessionManager from './services/sdkSessionManager.ts';
import fileService from './services/fileService.ts';
import projectManager from './services/projectManager.ts';
import db, { purgeExpiredSessions, getTunnelCredentials } from './services/database.ts';
import '../shared/types/server.ts'; // session augmentation

// --- SQLite session store (uses existing better-sqlite3 db) ---
class SQLiteSessionStore extends session.Store {
  private getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > datetime(\'now\')');
  private setStmt = db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, datetime(?, \'unixepoch\'))');
  private destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
  private touchStmt = db.prepare('UPDATE sessions SET expired = datetime(?, \'unixepoch\') WHERE sid = ?');

  get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
    try {
      const row = this.getStmt.get(sid) as { sess: string } | undefined;
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const maxAge = sess.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      const expiredEpoch = Math.floor((Date.now() + maxAge) / 1000);
      this.setStmt.run(sid, JSON.stringify(sess), expiredEpoch);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      this.destroyStmt.run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const maxAge = sess.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      const expiredEpoch = Math.floor((Date.now() + maxAge) / 1000);
      this.touchStmt.run(expiredEpoch, sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}

const app = express();
const server = http.createServer(app);
const env = config.dashboardEnv;

// Purge expired sessions on startup
purgeExpiredSessions();

// Purge expired sessions every hour
setInterval(() => purgeExpiredSessions(), 60 * 60 * 1000);

// Session middleware — env-specific cookie name and path, backed by SQLite
const sessionMiddleware = session({
  store: new SQLiteSessionStore(),
  name: `connect.sid.${env}`,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production' && process.env.FORCE_HTTPS === 'true',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
    path: config.nodeEnv === 'production' ? `/${env}` : '/',
  },
});

// Middleware
app.use(cors({
  origin: config.nodeEnv === 'development' ? 'http://localhost:5173' : undefined,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(sessionMiddleware);
app.use(authMiddleware);

// Collect all routes into one router
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/projects', projectRoutes);
apiRouter.use('/projects/:id/scripts', scriptRoutes);
apiRouter.use('/github', githubRoutes);
apiRouter.use('/tunnel-auth', tunnelAuthRoutes);
apiRouter.use('/', settingsRoutes);
apiRouter.use('/billing', billingRoutes);
apiRouter.use('/migrate', migrateRoutes);

// Mount at both paths (env-prefixed for tunnel, plain for dev/direct)
app.use(`/${env}/api`, apiRouter);
app.use('/api', apiRouter);

// Socket.IO setup — env-prefixed path
const io = new SocketIOServer(server, {
  path: `/${env}/socket.io`,
  cors: {
    origin: config.nodeEnv === 'development' ? 'http://localhost:5173' : undefined,
    credentials: true,
  },
});

// Share session with Socket.IO
io.engine.use(sessionMiddleware);
io.use(socketAuthMiddleware);

// Register socket handlers
registerSocketHandlers(io);

// Serve static files in production
if (config.nodeEnv === 'production') {
  // Read index.html once at startup and inject <base href> for env-prefixed routes
  const rawIndexHtml = fs.readFileSync(path.join(config.publicPath, 'index.html'), 'utf-8');
  const indexHtmlWithBase = rawIndexHtml.replace('<head>', `<head><base href="/${env}/">`);

  // Env-prefixed static files + SPA fallback
  app.use(`/${env}`, express.static(config.publicPath));
  app.get(`/${env}/*`, (req, res) => {
    if (!req.path.startsWith(`/${env}/api/`)) {
      res.type('html').send(indexHtmlWithBase);
    }
  });
  // Also serve at root for direct/dev access (no base tag needed)
  app.use(express.static(config.publicPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith(`/${env}/`)) {
      res.sendFile(path.join(config.publicPath, 'index.html'));
    }
  });
}

// Auto-start scripts marked with autostart
async function autostartScripts(): Promise<void> {
  try {
    const projects = await projectManager.listProjects();
    for (const proj of projects) {
      const project = await projectManager.getProject(proj.id);
      if (!project) continue;
      for (const script of (project.scripts || [])) {
        if (script.autostart) {
          const cwd = projectManager.getProjectPath(proj.id);
          console.log(`Auto-starting: ${proj.name} / ${script.label}`);
          processManager.spawnProcess(proj.id, script.id, script.command, cwd, io);
        }
      }
    }
  } catch (err) {
    console.error('Error auto-starting scripts:', err);
  }
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('Shutting down...');
  await tunnelManager.deactivateAllEndpoints();
  processManager.killAll();
  sdkSessionManager.endAllSessions();
  fileService.stopAllWatching();
  await tunnelManager.closeAll();
  io.close();
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
server.listen(config.port, async () => {
  console.log(`Claude Dashboard running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}, dashboardEnv: ${env}`);
  // Restore persisted credentials (local mode only)
  if (config.dashboardEnv === 'local' && !config.tunnelApiKey) {
    const saved = getTunnelCredentials();
    if (saved) {
      console.log(`[startup] Restoring persisted tunnel credentials for subdomain=${saved.userSubdomain}`);
      config.tunnelApiKey = saved.apiKey;
      config.tunnelUserSubdomain = saved.userSubdomain;
      if (saved.userId) {
        tunnelManager.setUserInfo({
          apiKey: saved.apiKey,
          userSubdomain: saved.userSubdomain,
          userId: saved.userId,
          email: saved.email || '',
          username: saved.username || '',
          plan: (saved.plan === 'pro' ? 'pro' : 'free') as 'free' | 'pro',
        });
      }
    }
  }

  if (config.tunnelMode === 'tunnel-service' && config.tunnelApiKey && config.tunnelUserSubdomain) {
    // Auto-connect using env vars — tunnel is immediately available
    tunnelManager.setCredentials(config.tunnelApiKey, config.tunnelUserSubdomain);

    // Fetch user info so tryAutoBootstrapSession() can create sessions
    if (config.tunnelServiceUrl) {
      try {
        const meRes = await fetch(`${config.tunnelServiceUrl}/api/users/me`, {
          headers: { 'Authorization': `users API-Key ${config.tunnelApiKey}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json() as { user?: { id?: string; email?: string; username?: string; plan?: string } };
          if (meData.user) {
            tunnelManager.setUserInfo({
              apiKey: config.tunnelApiKey,
              userSubdomain: config.tunnelUserSubdomain,
              userId: meData.user.id || '',
              email: meData.user.email || '',
              username: meData.user.username || '',
              plan: meData.user.plan === 'pro' ? 'pro' : 'free',
            });
          }
        }
      } catch (err) {
        console.error('[startup] Failed to fetch user info for session bootstrap:', err);
      }
    }
  } else if (config.tunnelMode === 'ngrok') {
    // ngrok mode unchanged
    const url = await tunnelManager.startDashboardTunnel(config.port);
    if (url) {
      console.log(`Dashboard tunnel: ${url}`);
    }
  } else if (config.tunnelMode === 'tunnel-service') {
    console.log('[tunnel] TUNNEL_API_KEY not set. Tunnel activates after first user OAuth.');
  }
  autostartScripts();

  // Sync SSH keys and credentials on startup in VPS mode
  if (config.isVps) {
    sshKeyService.syncAuthorizedKeys();
    credentialService.syncCredentials();
  }
});
