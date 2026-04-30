import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { execFile } from 'child_process';
import { promisify } from 'util';
import projectManager from '../services/projectManager.ts';
import gitService from '../services/gitService.ts';
import sdkSessionManager from '../services/sdkSessionManager.ts';
import { generateChatTitleAndDescription } from '../services/aiTitleGenerator.ts';
import { readFirstUserPrompt } from '../services/jsonlWatcher.ts';
import config from '../config.ts';
import activeChatsTracker from '../services/activeChatsTracker.ts';
import { killSession } from '../sockets/claude-code.ts';

const execFileAsync = promisify(execFile);

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 0;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || '';
    const pinnedOnly = req.query.pinned === '1';

    if (pinnedOnly) {
      const projects = projectManager.listPinnedProjects();
      res.json({ projects, total: projects.length });
    } else if (search && limit > 0) {
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
    const { name, path: projectPath, repoUrl, defaultAdapter, mode } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await projectManager.createProject(name, projectPath, repoUrl);
    // Set default adapter if specified
    if (defaultAdapter && result.project) {
      projectManager.updateProject(result.project.id, { defaultAdapter });
      result.project.defaultAdapter = defaultAdapter;
    }
    // Set workspace mode if explicitly specified (otherwise column default 'simple' applies)
    if ((mode === 'simple' || mode === 'dev') && result.project) {
      projectManager.updateProject(result.project.id, { mode });
      result.project.mode = mode;
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
    const { name, path: projectPath, defaultAdapter, mode } = req.body;
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
    if (mode === 'simple' || mode === 'dev') {
      projectManager.updateProject(project.id, { mode });
      project.mode = mode;
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
    if (req.body.mode !== undefined && req.body.mode !== 'simple' && req.body.mode !== 'dev') {
      return res.status(400).json({ error: "mode must be 'simple' or 'dev'" });
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

// Helper: resolve optional repoPath with path-traversal guard
function resolveRepoPath(req: Request, projectPath: string): string {
  const repoPath = (req.query.repoPath as string) || req.body?.repoPath || projectPath;
  const resolved = path.resolve(repoPath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    throw new Error('Repo path outside project');
  }
  return resolved;
}

// Discover git repos within project
router.get('/:id/repos', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const repos = await gitService.discoverRepos(projectPath);
    res.json({ repos });
  } catch (err) {
    console.error('Error discovering repos:', err);
    res.status(500).json({ error: 'Failed to discover repos' });
  }
});

// Git status (lightweight — paths + statuses only, no diff content)
router.get('/:id/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const targetPath = resolveRepoPath(req, projectPath);
    const files = await gitService.getStatus(targetPath);
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
    const targetPath = resolveRepoPath(req, projectPath);
    const diff = await gitService.getDiff(targetPath);
    res.json(diff);
  } catch (err) {
    console.error('Error getting diff:', err);
    res.status(500).json({ error: 'Failed to get diff' });
  }
});

router.post('/:id/revert', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const targetPath = resolveRepoPath(req, projectPath);
    const { filePath, all } = req.body;
    if (all) {
      await gitService.revertAll(targetPath);
    } else if (filePath) {
      await gitService.revertFile(targetPath, filePath);
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
    const targetPath = resolveRepoPath(req, projectPath);
    const { message } = req.body;
    await gitService.commitAll(targetPath, message || 'Changes by Claude Code');
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
    const targetPath = resolveRepoPath(req, projectPath);
    const isRepo = await gitService.checkIsRepo(targetPath);
    const ghToken = await hasGithubToken();
    if (!isRepo) {
      return res.json({ isRepo: false, branch: null, remotes: [], log: [], unpushedCount: 0, hasGithubToken: ghToken });
    }
    const [branch, remotes, log, unpushedCount] = await Promise.all([
      gitService.getCurrentBranch(targetPath),
      gitService.getRemotes(targetPath),
      gitService.getLog(targetPath),
      gitService.getUnpushedCount(targetPath),
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
    const targetPath = resolveRepoPath(req, projectPath);
    await gitService.init(targetPath);
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
    const targetPath = resolveRepoPath(req, projectPath);
    const { name, url } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }
    await gitService.addRemote(targetPath, name, url);
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
    const targetPath = resolveRepoPath(req, projectPath);
    await gitService.push(targetPath);
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
    const targetPath = resolveRepoPath(req, projectPath);
    const branches = await gitService.listBranches(targetPath);
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
    const targetPath = resolveRepoPath(req, projectPath);
    const { branch, force } = req.body;
    if (!branch) {
      return res.status(400).json({ error: 'branch is required' });
    }
    // Check for uncommitted changes unless force is set
    if (!force) {
      const dirty = await gitService.hasUncommittedChanges(targetPath);
      if (dirty) {
        return res.status(409).json({ error: 'You have uncommitted changes. Commit or stash them before switching branches.' });
      }
    }
    await gitService.checkoutBranch(targetPath, branch);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error checking out branch:', err);
    res.status(500).json({ error: err.message || 'Failed to checkout branch' });
  }
});

// Known MIME types — we want iOS to recognise images/PDFs so its Share Sheet
// offers "Save Image" / preview instead of treating everything as opaque bytes.
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', heic: 'image/heic', avif: 'image/avif',
  ico: 'image/x-icon', tiff: 'image/tiff',
  pdf: 'application/pdf', zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  json: 'application/json', xml: 'application/xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  html: 'text/html', css: 'text/css',
};

function mimeForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] || 'application/octet-stream';
}

// File download (binary-safe, streams the file with a correct MIME type).
// Query: ?path=<relative>&inline=1 — with inline=1 we omit Content-Disposition
// so the response can be used as an <img>/<video>/iframe src.
router.get('/:id/files/download', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const filePath = req.query.path as string;
    const inline = req.query.inline === '1';
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
    const mime = mimeForFile(basename);
    if (!inline) {
      res.setHeader('Content-Disposition', `attachment; filename="${basename.replace(/"/g, '\\"')}"`);
    }
    res.setHeader('Content-Type', mime);
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

    // Clean up empty SDK chats (only on first page / no search — avoid during paginated browsing).
    // Skip claude-code chats: they don't use chat_messages and get a session_id on start.
    if (offset === 0 && !search) {
      const allChats = projectManager.listChats(req.params.id);
      const emptyChats = allChats.filter(c =>
        c.label === 'New Chat'
        && !c.draftMessage
        && c.adapter !== 'claude-code'
        && (!projectManager.getChatMessages(c.id) || projectManager.getChatMessages(c.id).length === 0)
      );
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
    // Use explicit adapter if provided, otherwise fall back to project default (then global default)
    const { resolveDefaultAdapter } = await import('../services/database.ts');
    let chatAdapter = adapter || project.defaultAdapter || resolveDefaultAdapter();
    // Defense-in-depth: simple-mode workspaces always use the SDK adapter for new chats,
    // even if the client requests something else. Existing chats keep their own adapter.
    if (project.mode === 'simple') {
      chatAdapter = 'claude-agent-sdk';
    }

    // Validate adapter is registered
    const { adapterRegistry } = await import('../adapters/registry.ts');
    if (!adapterRegistry.has(chatAdapter)) {
      return res.status(400).json({ error: `Unknown adapter: ${chatAdapter}` });
    }

    // Validate adapter is enabled (if adapter_settings exist)
    const { isAdapterEnabled, hasAnyAdapterSettings } = await import('../services/database.ts');
    if (hasAnyAdapterSettings() && !isAdapterEnabled(chatAdapter)) {
      return res.status(400).json({ error: `Adapter "${chatAdapter}" is not enabled. Configure it in Settings.` });
    }

    const chat = projectManager.createChat(req.params.id, label, chatAdapter);
    activeChatsTracker.onChatCreated(chat.id, req.params.id, chat.label);
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

    // Broadcast label change if the label was updated
    if (req.body.label && req.body.label !== chat.label) {
      const io = activeChatsTracker.getIO();
      if (io) {
        io.to(`project:${req.params.id}`).emit('claude:chat-renamed', { chatId: req.params.chatId, label: req.body.label });
        io.to(`claude:${req.params.chatId}`).emit('claude:chat-renamed', { chatId: req.params.chatId, label: req.body.label });
      }
      activeChatsTracker.onChatRenamed(req.params.chatId, req.body.label);
    }

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
    activeChatsTracker.onChatRead(req.params.chatId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking chat read:', err);
    res.status(500).json({ error: 'Failed to mark chat read' });
  }
});

router.put('/:id/chats/:chatId/unread', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const chat = projectManager.getChat(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    projectManager.markChatUnread(req.params.chatId);
    activeChatsTracker.onChatUnread(req.params.chatId, req.params.id, chat.label);
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking chat unread:', err);
    res.status(500).json({ error: 'Failed to mark chat unread' });
  }
});

router.put('/:id/chats/:chatId/favorite', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const chat = projectManager.getChat(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const favorite = !!req.body?.favorite;
    projectManager.setChatFavorite(req.params.chatId, favorite);
    activeChatsTracker.refreshChatMeta(req.params.chatId, req.params.id);
    res.json({ success: true, favorite });
  } catch (err) {
    console.error('Error toggling chat favorite:', err);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

router.put('/:id/chats/:chatId/order', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const chat = projectManager.getChat(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const prevId = req.body?.prevId ?? null;
    const nextId = req.body?.nextId ?? null;
    projectManager.reorderChat(req.params.id, req.params.chatId, prevId, nextId);
    activeChatsTracker.refreshChatMeta(req.params.chatId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error reordering chat:', err);
    res.status(500).json({ error: 'Failed to reorder chat' });
  }
});

router.put('/:id/chats/:chatId/dismiss', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const { chatId } = req.params;
    // Kill both CC (PTY) and SDK sessions, then remove from tracker
    killSession(chatId);
    sdkSessionManager.endSession(chatId);
    projectManager.markChatDismissed(chatId);
    activeChatsTracker.onChatDismiss(chatId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error dismissing chat:', err);
    res.status(500).json({ error: 'Failed to dismiss chat' });
  }
});

router.post('/:id/chats/:chatId/generate-title', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    const chat = projectManager.getChat(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Get first user message — try chat_messages (SDK) then JSONL (CC)
    let firstPrompt: string | null = null;

    const messages = projectManager.getChatMessages(req.params.chatId);
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      firstPrompt = typeof firstUserMsg.content === 'string'
        ? firstUserMsg.content
        : Array.isArray(firstUserMsg.content)
          ? (firstUserMsg.content.find((b: any) => b.type === 'text') as any)?.text
          : null;
    }

    if (!firstPrompt && chat.sessionId) {
      const projectPath = projectManager.getProjectPath(req.params.id);
      firstPrompt = readFirstUserPrompt(chat.sessionId, projectPath);
    }

    if (!firstPrompt) {
      return res.status(400).json({ error: 'No user message found to generate title from' });
    }

    const result = await generateChatTitleAndDescription(firstPrompt);
    if (!result) {
      return res.status(500).json({ error: 'Failed to generate title' });
    }

    projectManager.updateChat(req.params.chatId, { label: result.title, description: result.description || null });

    // Broadcast title change to all clients in the project + chat rooms
    const io = activeChatsTracker.getIO();
    if (io) {
      io.to(`project:${req.params.id}`).emit('claude:chat-renamed', { chatId: req.params.chatId, label: result.title });
      io.to(`claude:${req.params.chatId}`).emit('claude:chat-renamed', { chatId: req.params.chatId, label: result.title });
    }
    activeChatsTracker.onChatRenamed(req.params.chatId, result.title);

    res.json({ title: result.title, description: result.description });
  } catch (err) {
    console.error('Error generating chat title:', err);
    res.status(500).json({ error: 'Failed to generate title' });
  }
});

router.delete('/:id/chats/:chatId', async (req: Request<{ id: string; chatId: string }>, res: Response) => {
  try {
    projectManager.deleteChat(req.params.chatId);
    activeChatsTracker.onChatDismiss(req.params.chatId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting chat:', err);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// --- Saved recordings ---

router.get('/:id/recordings', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const recordings = projectManager.listRecordings(req.params.id);
    res.json({ recordings });
  } catch (err) {
    console.error('Error listing recordings:', err);
    res.status(500).json({ error: 'Failed to list recordings' });
  }
});

router.post('/:id/recordings', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id, scripts, lines, browserLines, startedAt, stoppedAt } = req.body;
    if (!id || !scripts || !lines) {
      return res.status(400).json({ error: 'id, scripts, and lines are required' });
    }
    projectManager.saveRecording(req.params.id, {
      id,
      scripts,
      lines,
      browserLines: browserLines || [],
      startedAt,
      stoppedAt,
    });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Error saving recording:', err);
    res.status(500).json({ error: 'Failed to save recording' });
  }
});

router.delete('/:id/recordings/:recId', async (req: Request<{ id: string; recId: string }>, res: Response) => {
  try {
    projectManager.deleteRecording(req.params.recId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting recording:', err);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

// --- Prompt history (previous message picker) ---

router.get('/:id/prompt-history', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');

    if (!fs.existsSync(historyPath)) {
      return res.json({ entries: [] });
    }

    // Read the full history and filter by project path
    const entries: Array<{ display: string; timestamp: number; sessionId: string }> = [];
    const seen = new Set<string>();

    const fileStream = fs.createReadStream(historyPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const allEntries: Array<{ display: string; timestamp: number; sessionId: string }> = [];
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.project === project.path && entry.display) {
          allEntries.push({
            display: entry.display.trim(),
            timestamp: entry.timestamp || 0,
            sessionId: entry.sessionId || '',
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Sort newest-first, deduplicate by display text
    allEntries.sort((a, b) => b.timestamp - a.timestamp);
    for (const entry of allEntries) {
      if (seen.has(entry.display)) continue;
      seen.add(entry.display);
      entries.push(entry);
    }

    // Paginate
    const page = entries.slice(offset, offset + limit);
    res.json({ entries: page, total: entries.length });
  } catch (err) {
    console.error('Error reading prompt history:', err);
    res.status(500).json({ error: 'Failed to read prompt history' });
  }
});

export default router;
