import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import projectManager from '../services/projectManager.ts';
import gitService from '../services/gitService.ts';
import sdkSessionManager from '../services/sdkSessionManager.ts';
import config from '../config.ts';

const execFileAsync = promisify(execFile);

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 0;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || '';

    if (search && limit > 0) {
      const result = projectManager.searchProjectsPaginated(search, limit, offset);
      res.json({ projects: result.projects, total: result.total });
    } else if (limit > 0) {
      const result = projectManager.listProjectsPaginated(limit, offset);
      res.json({ projects: result.projects, total: result.total });
    } else {
      const projects = projectManager.listProjects();
      res.json({ projects });
    }
  } catch (err) {
    console.error('Error listing projects:', err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project });
  } catch (err) {
    console.error('Error getting project:', err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, path: projectPath, repoUrl, defaultAdapter } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await projectManager.createProject(name, projectPath, repoUrl);
    // Set default adapter if specified
    if (defaultAdapter && result.project) {
      projectManager.updateProject(result.project.id, { defaultAdapter });
      result.project.defaultAdapter = defaultAdapter;
    }
    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Register an existing directory as a project
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, path: projectPath, defaultAdapter } = req.body;
    if (!name || !projectPath) {
      return res.status(400).json({ error: 'Name and path are required' });
    }
    if (!fs.existsSync(projectPath)) {
      return res.status(400).json({ error: 'Path does not exist on disk' });
    }
    const project = projectManager.registerProject(name, projectPath);
    // Set default adapter if specified
    if (defaultAdapter) {
      projectManager.updateProject(project.id, { defaultAdapter });
      project.defaultAdapter = defaultAdapter;
    }
    res.status(201).json({ project });
  } catch (err: any) {
    console.error('Error registering project:', err);
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A project with this path is already registered' });
    }
    res.status(500).json({ error: 'Failed to register project' });
  }
});

router.patch('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    if (req.body.path !== undefined && (!req.body.path || !fs.existsSync(req.body.path))) {
      return res.status(400).json({ error: 'Path does not exist on disk' });
    }
    const project = projectManager.updateProject(req.params.id, req.body);
    res.json({ project });
  } catch (err: any) {
    if (err.message === 'Path does not exist or is not a directory') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error updating project:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.get('/:id/directory-exists', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const exists = projectManager.projectDirectoryExists(req.params.id);
    res.json({ exists });
  } catch (err: any) {
    if (err.message === 'Project not found') {
      return res.status(404).json({ error: 'Project not found' });
    }
    console.error('Error checking directory:', err);
    res.status(500).json({ error: 'Failed to check directory' });
  }
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleteFolder = req.body?.deleteFolder !== false;
    await projectManager.deleteProject(req.params.id, deleteFolder);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Git status (lightweight — paths + statuses only, no diff content)
router.get('/:id/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const files = await gitService.getStatus(projectPath);
    res.json({ files });
  } catch (err) {
    console.error('Error getting status:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Diff endpoints
router.get('/:id/diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const diff = await gitService.getDiff(projectPath);
    res.json(diff);
  } catch (err) {
    console.error('Error getting diff:', err);
    res.status(500).json({ error: 'Failed to get diff' });
  }
});

router.post('/:id/revert', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const { filePath, all } = req.body;
    if (all) {
      await gitService.revertAll(projectPath);
    } else if (filePath) {
      await gitService.revertFile(projectPath, filePath);
    } else {
      return res.status(400).json({ error: 'filePath or all required' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error reverting:', err);
    res.status(500).json({ error: 'Failed to revert' });
  }
});

router.post('/:id/commit', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const { message } = req.body;
    await gitService.commitAll(projectPath, message || 'Changes by Claude Code');
    res.json({ success: true });
  } catch (err) {
    console.error('Error committing:', err);
    res.status(500).json({ error: 'Failed to commit' });
  }
});

// Helper: detect GitHub token availability
async function hasGithubToken(): Promise<boolean> {
  if (config.githubToken) return true;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    return !!stdout.trim();
  } catch {
    return false;
  }
}

// Git info (bundled)
router.get('/:id/git-info', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const isRepo = await gitService.checkIsRepo(projectPath);
    const ghToken = await hasGithubToken();
    if (!isRepo) {
      return res.json({ isRepo: false, branch: null, remotes: [], log: [], unpushedCount: 0, hasGithubToken: ghToken });
    }
    const [branch, remotes, log, unpushedCount] = await Promise.all([
      gitService.getCurrentBranch(projectPath),
      gitService.getRemotes(projectPath),
      gitService.getLog(projectPath),
      gitService.getUnpushedCount(projectPath),
    ]);
    res.json({ isRepo, branch, remotes, log, unpushedCount, hasGithubToken: ghToken });
  } catch (err) {
    console.error('Error getting git info:', err);
    res.status(500).json({ error: 'Failed to get git info' });
  }
});

// Git init
router.post('/:id/git-init', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    await gitService.init(projectPath);
    res.json({ success: true });
  } catch (err) {
    console.error('Error initializing git:', err);
    res.status(500).json({ error: 'Failed to initialize git' });
  }
});

// Git remote add
router.post('/:id/git-remote', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const { name, url } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }
    await gitService.addRemote(projectPath, name, url);
    res.json({ success: true });
  } catch (err) {
    console.error('Error adding remote:', err);
    res.status(500).json({ error: 'Failed to add remote' });
  }
});

// Git push
router.post('/:id/git-push', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    await gitService.push(projectPath);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error pushing:', err);
    res.status(500).json({ error: err.message || 'Failed to push' });
  }
});

// Git branches
router.get('/:id/git-branches', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const branches = await gitService.listBranches(projectPath);
    res.json(branches);
  } catch (err) {
    console.error('Error listing branches:', err);
    res.status(500).json({ error: 'Failed to list branches' });
  }
});

// Git checkout
router.post('/:id/git-checkout', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const { branch, force } = req.body;
    if (!branch) {
      return res.status(400).json({ error: 'branch is required' });
    }
    // Check for uncommitted changes unless force is set
    if (!force) {
      const dirty = await gitService.hasUncommittedChanges(projectPath);
      if (dirty) {
        return res.status(409).json({ error: 'You have uncommitted changes. Commit or stash them before switching branches.' });
      }
    }
    await gitService.checkoutBranch(projectPath, branch);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error checking out branch:', err);
    res.status(500).json({ error: err.message || 'Failed to checkout branch' });
  }
});

// File download (binary-safe, streams with Content-Disposition)
router.get('/:id/files/download', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const projectPath = projectManager.getProjectPath(req.params.id);
    // Guard against path traversal
    const fullPath = path.resolve(path.join(projectPath, filePath));
    if (!fullPath.startsWith(path.resolve(projectPath))) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const basename = path.basename(fullPath);
    res.setHeader('Content-Disposition', `attachment; filename="${basename.replace(/"/g, '\\"')}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('File download stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });
  } catch (err: any) {
    console.error('Error downloading file:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Search GitHub repos (requires gh CLI or GITHUB_TOKEN)
router.get('/:id/github-repos', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const search = (req.query.q as string) || '';
    if (!search) {
      return res.json({ repos: [] });
    }

    const token = config.githubToken || await (async () => {
      try {
        const { stdout: t } = await execFileAsync('gh', ['auth', 'token']);
        return t.trim();
      } catch { return null; }
    })();

    if (!token) {
      return res.json({ repos: [] });
    }

    const apiRes = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(search)}&per_page=10&sort=updated`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!apiRes.ok) {
      return res.json({ repos: [] });
    }
    const data = await apiRes.json() as any;
    const repos = (data.items || []).map((r: any) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.clone_url,
      description: r.description,
      language: r.language,
      private: r.private,
    }));
    res.json({ repos });
  } catch (err) {
    console.error('Error searching GitHub repos:', err);
    res.json({ repos: [] });
  }
});

// Chat endpoints
router.get('/:id/chats', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 0;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || '';

    // Clean up empty chats (only on first page / no search — avoid during paginated browsing)
    if (offset === 0 && !search) {
      const allChats = projectManager.listChats(req.params.id);
      const emptyChats = allChats.filter(c => c.label === 'New Chat' && !c.draftMessage && (!projectManager.getChatMessages(c.id) || projectManager.getChatMessages(c.id).length === 0));
      for (const chat of emptyChats) {
        sdkSessionManager.endSession(chat.id);
        projectManager.deleteChat(chat.id);
      }
    }

    if (limit > 0) {
      const result = projectManager.listChatsPaginated(req.params.id, { limit, offset, search: search || undefined });
      res.json({ chats: result.chats, total: result.total });
    } else {
      const updatedChats = projectManager.listChats(req.params.id);
      const chatsWithHistory = updatedChats.map(c => ({
        ...c,
        history: projectManager.getChatMessages(c.id),
      }));
      res.json({ chats: chatsWithHistory });
    }
  } catch (err) {
    console.error('Error listing chats:', err);
    res.status(500).json({ error: 'Failed to list chats' });
  }
});

router.post('/:id/chats', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { label, adapter } = req.body;
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    // Use explicit adapter if provided, otherwise fall back to project default
    const chatAdapter = adapter || project.defaultAdapter || 'claude-agent-sdk';
    const chat = projectManager.createChat(req.params.id, label, chatAdapter);
    res.status(201).json({ chat });
  } catch (err) {
    console.error('Error creating chat:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

router.patch('/:id/chats/:chatId', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const chat = projectManager.getChat(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const updated = projectManager.updateChat(req.params.chatId, req.body);
    res.json({ chat: updated });
  } catch (err) {
    console.error('Error updating chat:', err);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

router.put('/:id/chats/:chatId/draft', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const { text } = req.body;
    projectManager.updateDraft(req.params.chatId, text || '');
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving draft:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

router.put('/:id/chats/:chatId/stashed-input', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const { text } = req.body;
    projectManager.updateStashedInput(req.params.chatId, text || '');
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving stashed input:', err);
    res.status(500).json({ error: 'Failed to save stashed input' });
  }
});

router.put('/:id/chats/:chatId/read', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    projectManager.markChatRead(req.params.chatId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking chat read:', err);
    res.status(500).json({ error: 'Failed to mark chat read' });
  }
});

router.delete('/:id/chats/:chatId', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    projectManager.deleteChat(req.params.chatId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting chat:', err);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

export default router;
