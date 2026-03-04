import { Router, type Request, type Response } from 'express';
import projectManager from '../services/projectManager.ts';
import processManager from '../services/processManager.ts';
import tunnelManager from '../services/tunnelManager.ts';
import type { RunningProcess } from '../../shared/types/models.ts';

const router = Router({ mergeParams: true });

router.get('/processes', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectId = req.params.id;

    const scripts = projectManager.listScripts(projectId);
    const projectProcesses = processManager.getProjectProcesses(projectId);

    const processes: RunningProcess[] = [];
    for (const [scriptId, entry] of projectProcesses) {
      const matchedScript = scripts.find((s: { id: string }) => s.id === scriptId);
      const isShell = scriptId.startsWith('shell-');
      const detectedPorts = entry.status === 'running'
        ? await processManager.getDetectedPorts(projectId, scriptId)
        : [];
      const tunnelUrls = (entry.status === 'running' && detectedPorts.length > 0)
        ? await tunnelManager.getTunnelUrls(detectedPorts, `${projectId}:${scriptId}`)
        : {};
      processes.push({
        scriptId,
        command: entry.command,
        status: entry.status,
        startedAt: entry.startedAt,
        exitCode: entry.exitCode,
        label: isShell ? 'Terminal' : matchedScript?.label,
        isShell,
        detectedPorts,
        tunnelUrls,
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

router.post('/', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { label, command, autostart } = req.body;
    if (!label || !command) {
      return res.status(400).json({ error: 'Label and command are required' });
    }
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const script = projectManager.createScript(req.params.id, label, command, autostart);
    res.status(201).json({ script });
  } catch (err) {
    console.error('Error adding script:', err);
    res.status(500).json({ error: 'Failed to add script' });
  }
});

router.patch('/:scriptId', async (req: Request<{ id: string; scriptId: string }>, res: Response) => {
  try {
    const { label, command, autostart } = req.body;
    const script = projectManager.updateScript(req.params.scriptId, { label, command, autostart });
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
