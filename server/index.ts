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
import registerSocketHandlers from './sockets/index.ts';
import processManager from './services/processManager.ts';
import tunnelManager from './services/tunnelManager.ts';
import sdkSessionManager from './services/sdkSessionManager.ts';
import fileService from './services/fileService.ts';
import projectManager from './services/projectManager.ts';
import fs from 'fs/promises';
import '../shared/types/server.ts'; // session augmentation

const app = express();
const server = http.createServer(app);

// Session middleware
const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production' && process.env.FORCE_HTTPS === 'true',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
});

// Middleware
app.use(cors({
  origin: config.nodeEnv === 'development' ? 'http://localhost:5173' : undefined,
  credentials: true,
}));
app.use(express.json());

// Serve static assets BEFORE auth middleware so manifest.json, sw.js, CSS/JS
// are publicly accessible (the SPA handles its own auth via API calls)
if (config.nodeEnv === 'production') {
  app.use(express.static(config.publicPath));
}

app.use(sessionMiddleware);
app.use(authMiddleware);

// REST routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects/:id/scripts', scriptRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/tunnel-auth', tunnelAuthRoutes);

// Socket.IO setup
const io = new SocketIOServer(server, {
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

// SPA fallback — serve index.html for non-API routes (static assets already served above)
if (config.nodeEnv === 'production') {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(config.publicPath, 'index.html'));
    }
  });
}

// Ensure projects directory exists
await fs.mkdir(config.projectsBasePath, { recursive: true });

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
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Projects directory: ${config.projectsBasePath}`);
  if (config.tunnelMode === 'tunnel-service' && config.tunnelApiKey && config.tunnelUserSubdomain) {
    // Auto-connect using env vars — tunnel is immediately available
    tunnelManager.setCredentials(config.tunnelApiKey, config.tunnelUserSubdomain);
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
});
