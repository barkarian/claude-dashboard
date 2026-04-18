import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import * as tar from 'tar';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.ts';
import projectManager from '../services/projectManager.ts';
import db from '../services/database.ts';

const router = Router();

// In-memory migration status tracking
const migrationStatus: Record<string, {
  projectId: string;
  projectName: string;
  status: 'pending' | 'exporting' | 'transferring' | 'importing' | 'completed' | 'failed';
  progress: number; // 0-100
  error?: string;
}> = {};

// GET /api/migrate/projects — list all projects with disk sizes
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const projects = projectManager.listProjects();

    const projectsWithSize = await Promise.all(
      projects.map(async (p) => {
        let size = 0;
        try {
          // Use du to get directory size in bytes
          const output = execSync(`du -sk "${p.path}" 2>/dev/null || echo "0"`, { encoding: 'utf-8' });
          const kb = parseInt(output.split('\t')[0], 10);
          size = kb * 1024; // convert KB to bytes
        } catch {
          // Directory may not exist
        }

        return {
          id: p.id,
          name: p.name,
          path: p.path,
          size,
          chatsCount: p.chatsCount,
          scriptsCount: p.scriptsCount,
        };
      })
    );

    res.json({ projects: projectsWithSize });
  } catch (err) {
    console.error('Error listing migration projects:', err);
    res.status(500).json({ error: 'Failed to list projects for migration' });
  }
});

// POST /api/migrate/export/:projectId — package project as tar.gz + metadata JSON
router.post('/export/:projectId', async (req: Request<{ projectId: string }>, res: Response) => {
  try {
    const { projectId } = req.params;

    // Get full project data from SQLite
    const project = projectManager.getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectPath = projectManager.getProjectPath(projectId);
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project directory not found on disk' });
    }

    // Get scripts from DB
    const scripts = projectManager.listScripts(projectId);

    // Get chats with messages from DB
    const chats = projectManager.listChats(projectId);
    const chatsWithMessages = chats.map(chat => ({
      ...chat,
      messages: projectManager.getChatMessages(chat.id),
    }));

    // Create tar.gz of the project directory
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claw-migrate-'));
    const archivePath = path.join(tmpDir, 'project.tar.gz');

    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: path.dirname(projectPath),
        filter: (entryPath: string) => {
          // Skip node_modules and .git/objects to keep archive small
          if (entryPath.includes('node_modules/')) return false;
          return true;
        },
      },
      [path.basename(projectPath)]
    );

    // Read archive as base64
    const archiveBuffer = await fsp.readFile(archivePath);
    const archiveBase64 = archiveBuffer.toString('base64');

    // Clean up temp file
    await fsp.rm(tmpDir, { recursive: true, force: true });

    // Bundle metadata + archive
    const bundle = {
      metadata: {
        project: {
          id: project.id,
          name: project.name,
          repo: project.repo,
          createdAt: project.createdAt,
        },
        scripts,
        chats: chatsWithMessages,
      },
      archive: archiveBase64,
    };

    res.json(bundle);
  } catch (err) {
    console.error('Error exporting project:', err);
    res.status(500).json({ error: 'Failed to export project' });
  }
});

// POST /api/migrate/import — receive and unpack project archive (VPS mode only)
router.post('/import', async (req: Request, res: Response) => {
  if (!config.isVps) {
    return res.status(403).json({ error: 'Import is only available on VPS instances' });
  }

  try {
    const { metadata, archive } = req.body;
    if (!metadata || !archive) {
      return res.status(400).json({ error: 'metadata and archive are required' });
    }

    const { project: projectMeta, scripts, chats } = metadata;

    // Determine target path
    const projectsDir = path.join(os.homedir(), 'projects');
    await fsp.mkdir(projectsDir, { recursive: true });
    const targetPath = path.join(projectsDir, projectMeta.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

    // Unpack archive
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claw-import-'));
    const archivePath = path.join(tmpDir, 'project.tar.gz');
    const archiveBuffer = Buffer.from(archive, 'base64');
    await fsp.writeFile(archivePath, archiveBuffer);

    // Extract to target location
    await fsp.mkdir(targetPath, { recursive: true });
    await tar.extract({
      file: archivePath,
      cwd: targetPath,
      strip: 1, // strip the top-level directory name from the archive
    });

    // Clean up temp file
    await fsp.rm(tmpDir, { recursive: true, force: true });

    // Generate a new project ID (might collide with existing)
    const slug = projectMeta.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    let projectId = slug;
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (existing) {
      projectId = `${slug}-${uuidv4().slice(0, 8)}`;
    }

    // Also check path uniqueness
    const existingPath = db.prepare('SELECT id FROM projects WHERE path = ?').get(targetPath);
    if (existingPath) {
      return res.status(409).json({ error: 'A project at this path already exists' });
    }

    // Insert project into SQLite
    const now = new Date().toISOString();
    db.prepare('INSERT INTO projects (id, name, path, repo, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, projectMeta.name, targetPath, projectMeta.repo || null, projectMeta.createdAt || now);

    // Insert scripts
    for (const script of (scripts || [])) {
      const scriptId = uuidv4();
      db.prepare('INSERT INTO scripts (id, project_id, label, command) VALUES (?, ?, ?, ?)')
        .run(scriptId, projectId, script.label, script.command);
    }

    // Insert chats and messages
    for (const chat of (chats || [])) {
      const chatId = uuidv4();
      db.prepare('INSERT INTO chats (id, project_id, label, sdk_session_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(chatId, projectId, chat.label, chat.sdkSessionId || null, chat.createdAt || now);

      const messages = chat.messages || chat.history || [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const msgId = uuidv4();
        const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        db.prepare('INSERT INTO chat_messages (id, chat_id, role, content, timestamp, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
          .run(msgId, chatId, msg.role, contentStr, msg.timestamp || now, i);
      }
    }

    res.json({ success: true, projectId, path: targetPath });
  } catch (err: any) {
    console.error('Error importing project:', err);
    res.status(500).json({ error: err.message || 'Failed to import project' });
  }
});

// GET /api/migrate/status — migration progress
router.get('/status', async (req: Request, res: Response) => {
  try {
    res.json({ migrations: Object.values(migrationStatus) });
  } catch (err) {
    console.error('Error getting migration status:', err);
    res.status(500).json({ error: 'Failed to get migration status' });
  }
});

// POST /api/migrate/status — update migration status (called by the client during migration)
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { projectId, projectName, status, progress, error } = req.body;
    if (!projectId || !status) {
      return res.status(400).json({ error: 'projectId and status are required' });
    }
    migrationStatus[projectId] = { projectId, projectName, status, progress: progress || 0, error };
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating migration status:', err);
    res.status(500).json({ error: 'Failed to update migration status' });
  }
});

// POST /api/migrate/remote-projects — proxy request to local dashboard (VPS only)
// Fetches the project list from the local dashboard via its migration source URL
router.post('/remote-projects', async (req: Request, res: Response) => {
  if (!config.isVps) {
    return res.status(403).json({ error: 'Only available on VPS instances' });
  }

  const sourceUrl = config.migrationSourceUrl;
  if (!sourceUrl) {
    return res.status(400).json({ error: 'Migration source URL not configured' });
  }

  try {
    const response = await fetch(`${sourceUrl}/api/migrate/projects`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Remote dashboard returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Error fetching remote projects:', err);
    res.status(502).json({ error: `Failed to reach local dashboard: ${err.message}` });
  }
});

// POST /api/migrate/remote-export/:projectId — proxy export from local dashboard (VPS only)
router.post('/remote-export/:projectId', async (req: Request<{ projectId: string }>, res: Response) => {
  if (!config.isVps) {
    return res.status(403).json({ error: 'Only available on VPS instances' });
  }

  const sourceUrl = config.migrationSourceUrl;
  if (!sourceUrl) {
    return res.status(400).json({ error: 'Migration source URL not configured' });
  }

  try {
    const response = await fetch(`${sourceUrl}/api/migrate/export/${req.params.projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Remote dashboard returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Error exporting remote project:', err);
    res.status(502).json({ error: `Failed to export from local dashboard: ${err.message}` });
  }
});

export default router;
