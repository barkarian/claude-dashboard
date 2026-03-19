import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import projectManager from '../services/projectManager.ts';
import gitService from '../services/gitService.ts';
import sdkSessionManager from '../services/sdkSessionManager.ts';

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
    const { name, path: projectPath, repoUrl } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await projectManager.createProject(name, projectPath, repoUrl);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Register an existing directory as a project
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, path: projectPath } = req.body;
    if (!name || !projectPath) {
      return res.status(400).json({ error: 'Name and path are required' });
    }
    if (!fs.existsSync(projectPath)) {
      return res.status(400).json({ error: 'Path does not exist on disk' });
    }
    const project = projectManager.registerProject(name, projectPath);
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
    const project = projectManager.updateProject(req.params.id, req.body);
    res.json({ project });
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    await projectManager.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: 'Failed to delete project' });
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

// Chat endpoints
router.get('/:id/chats', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 0;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || '';

    // Clean up empty chats (only on first page / no search — avoid during paginated browsing)
    if (offset === 0 && !search) {
      const allChats = projectManager.listChats(req.params.id);
      const emptyChats = allChats.filter(c => c.label === 'New Chat' && (!projectManager.getChatMessages(c.id) || projectManager.getChatMessages(c.id).length === 0));
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
    const { label } = req.body;
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const chat = projectManager.createChat(req.params.id, label);
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
