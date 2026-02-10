import { Router } from 'express';
import projectManager from '../services/projectManager.js';
import gitService from '../services/gitService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const projects = await projectManager.listProjects();
    res.json({ projects });
  } catch (err) {
    console.error('Error listing projects:', err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project });
  } catch (err) {
    console.error('Error getting project:', err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, repoUrl } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await projectManager.createProject(name, repoUrl);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const project = await projectManager.updateProject(req.params.id, req.body);
    res.json({ project });
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await projectManager.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Diff endpoints
router.get('/:id/diff', async (req, res) => {
  try {
    const projectPath = projectManager.getProjectPath(req.params.id);
    const diff = await gitService.getDiff(projectPath);
    res.json(diff);
  } catch (err) {
    console.error('Error getting diff:', err);
    res.status(500).json({ error: 'Failed to get diff' });
  }
});

router.post('/:id/revert', async (req, res) => {
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

router.post('/:id/commit', async (req, res) => {
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
router.get('/:id/chats', async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ chats: project.chats || [] });
  } catch (err) {
    console.error('Error listing chats:', err);
    res.status(500).json({ error: 'Failed to list chats' });
  }
});

router.post('/:id/chats', async (req, res) => {
  try {
    const { label } = req.body;
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const { v4: uuidv4 } = await import('uuid');
    const chat = {
      id: uuidv4(),
      label: label || 'New Chat',
      createdAt: new Date().toISOString(),
      history: [],
      claudeSessionId: uuidv4(),
    };
    project.chats = project.chats || [];
    project.chats.push(chat);
    await projectManager.updateProject(req.params.id, { chats: project.chats });
    res.status(201).json({ chat });
  } catch (err) {
    console.error('Error creating chat:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

router.patch('/:id/chats/:chatId', async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const chatIndex = (project.chats || []).findIndex(c => c.id === req.params.chatId);
    if (chatIndex === -1) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    Object.assign(project.chats[chatIndex], req.body);
    await projectManager.updateProject(req.params.id, { chats: project.chats });
    res.json({ chat: project.chats[chatIndex] });
  } catch (err) {
    console.error('Error updating chat:', err);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

router.delete('/:id/chats/:chatId', async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    project.chats = (project.chats || []).filter(c => c.id !== req.params.chatId);
    await projectManager.updateProject(req.params.id, { chats: project.chats });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting chat:', err);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

export default router;
