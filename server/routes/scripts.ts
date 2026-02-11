import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import projectManager from '../services/projectManager.ts';
import processManager from '../services/processManager.ts';
import type { Script, RunningProcess } from '../../shared/types/models.ts';

const router = Router({ mergeParams: true });

router.get('/processes', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectId = req.params.id;

    const project = await projectManager.getProject(projectId);
    const scripts = project?.scripts || [];

    const projectProcesses = processManager.getProjectProcesses(projectId);

    const processes: RunningProcess[] = [];
    for (const [scriptId, entry] of projectProcesses) {
      const matchedScript = scripts.find((s: { id: string }) => s.id === scriptId);
      processes.push({
        scriptId,
        command: entry.command,
        status: entry.status,
        startedAt: entry.startedAt,
        exitCode: entry.exitCode,
        label: matchedScript?.label,
      });
    }

    const runningCount = processes.filter((p: RunningProcess) => p.status === 'running').length;
    res.json({ processes, runningCount });
  } catch (err) {
    console.error('Error listing processes:', err);
    res.status(500).json({ error: 'Failed to list processes' });
  }
});

router.get('/', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const scripts = (project.scripts || []).map(script => ({
      ...script,
      status: processManager.getProcess(req.params.id, script.id)?.status || 'stopped',
    }));
    res.json({ scripts });
  } catch (err) {
    console.error('Error listing scripts:', err);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

router.post('/', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { label, command, autostart } = req.body;
    if (!label || !command) {
      return res.status(400).json({ error: 'Label and command are required' });
    }
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const script: Script = {
      id: uuidv4(),
      label,
      command,
      autostart: autostart || false,
    };
    project.scripts = project.scripts || [];
    project.scripts.push(script);
    await projectManager.updateProject(req.params.id, { scripts: project.scripts });
    res.status(201).json({ script });
  } catch (err) {
    console.error('Error adding script:', err);
    res.status(500).json({ error: 'Failed to add script' });
  }
});

router.patch('/:scriptId', async (req: Request<{ id: string; scriptId: string }>, res: Response) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const scriptIndex = (project.scripts || []).findIndex(s => s.id === req.params.scriptId);
    if (scriptIndex === -1) {
      return res.status(404).json({ error: 'Script not found' });
    }
    const { label, command, autostart } = req.body;
    if (label !== undefined) project.scripts[scriptIndex].label = label;
    if (command !== undefined) project.scripts[scriptIndex].command = command;
    if (autostart !== undefined) project.scripts[scriptIndex].autostart = autostart;
    await projectManager.updateProject(req.params.id, { scripts: project.scripts });
    res.json({ script: project.scripts[scriptIndex] });
  } catch (err) {
    console.error('Error updating script:', err);
    res.status(500).json({ error: 'Failed to update script' });
  }
});

router.delete('/:scriptId', async (req: Request<{ id: string; scriptId: string }>, res: Response) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    processManager.killProcess(req.params.id, req.params.scriptId);
    project.scripts = (project.scripts || []).filter(s => s.id !== req.params.scriptId);
    await projectManager.updateProject(req.params.id, { scripts: project.scripts });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting script:', err);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

export default router;
