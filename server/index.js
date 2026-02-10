import http from 'http';
import path from 'path';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import config from './config.js';
import { authMiddleware, socketAuthMiddleware } from './auth.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import scriptRoutes from './routes/scripts.js';
import githubRoutes from './routes/github.js';
import registerSocketHandlers from './sockets/index.js';
import processManager from './services/processManager.js';
import claudeManager from './services/claudeManager.ts';
import fileService from './services/fileService.js';
import projectManager from './services/projectManager.js';
import fs from 'fs/promises';

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
app.use(sessionMiddleware);
app.use(authMiddleware);

// REST routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects/:id/scripts', scriptRoutes);
app.use('/api/github', githubRoutes);

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

// Serve static files in production
if (config.nodeEnv === 'production') {
  app.use(express.static(config.publicPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(config.publicPath, 'index.html'));
    }
  });
}

// Ensure projects directory exists
await fs.mkdir(config.projectsBasePath, { recursive: true });

// Auto-start scripts marked with autostart
async function autostartScripts() {
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
function shutdown() {
  console.log('Shutting down...');
  processManager.killAll();
  claudeManager.endAllSessions();
  fileService.stopAllWatching();
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
server.listen(config.port, () => {
  console.log(`Claude Dashboard running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Projects directory: ${config.projectsBasePath}`);
  autostartScripts();
});
