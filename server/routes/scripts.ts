import { Router, type Request, type Response } from 'express';
import projectManager from '../services/projectManager.ts';
import processManager from '../services/processManager.ts';

const router = Router({ mergeParams: true });

router.get('/processes', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const processes = await processManager.getProcessesList(req.params.id);
    const runningCount = processes.filter(p => p.status === 'running').length;
    res.json({ processes, runningCount });
  } catch (err) {
    console.error('Error listing processes:', err);
    res.status(500).json({ error: 'Failed to list processes' });
  }
});

router.get('/processes/:scriptId/buffer', (req: Request<{ id: string; scriptId: string }>, res: Response) => {
  try {
    const buffer = processManager.getBuffer(req.params.id, req.params.scriptId);
    res.json({ buffer });
  } catch (err) {
    console.error('Error getting process buffer:', err);
    res.status(500).json({ error: 'Failed to get buffer' });
  }
});

router.get('/', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const scripts = projectManager.listScripts(req.params.id);
    const scriptsWithStatus = scripts.map(script => ({
      ...script,
      status: processManager.getProcess(req.params.id, script.id)?.status || 'stopped',
    }));
    res.json({ scripts: scriptsWithStatus });
  } catch (err) {
    console.error('Error listing scripts:', err);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

router.patch('/reorder', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || !orderedIds.every(s => typeof s === 'string')) {
      return res.status(400).json({ error: 'orderedIds must be an array of strings' });
    }
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    projectManager.reorderScripts(req.params.id, orderedIds);
    res.json({ success: true });
  } catch (err) {
    console.error('Error reordering scripts:', err);
    res.status(500).json({ error: 'Failed to reorder scripts' });
  }
});

router.post('/', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { label, command } = req.body;
    if (!label || !command) {
      return res.status(400).json({ error: 'Label and command are required' });
    }
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const script = projectManager.createScript(req.params.id, label, command);
    res.status(201).json({ script });
  } catch (err) {
    console.error('Error adding script:', err);
    res.status(500).json({ error: 'Failed to add script' });
  }
});

router.patch('/:scriptId', async (req: Request<{ id: string; scriptId: string }>, res: Response) => {
  try {
    const { label, command } = req.body;
    const script = projectManager.updateScript(req.params.scriptId, { label, command });
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json({ script });
  } catch (err) {
    console.error('Error updating script:', err);
    res.status(500).json({ error: 'Failed to update script' });
  }
});

router.delete('/:scriptId', async (req: Request<{ id: string; scriptId: string }>, res: Response) => {
  try {
    processManager.killProcess(req.params.id, req.params.scriptId);
    projectManager.deleteScript(req.params.scriptId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting script:', err);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

export default router;
