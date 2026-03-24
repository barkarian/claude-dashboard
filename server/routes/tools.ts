import { Router, type Request, type Response } from 'express';
import toolManager from '../services/toolManager.ts';
import permissionManager from '../services/permissionManager.ts';

const router = Router();

// GET /api/tools/status — detect all tools
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const tools = await toolManager.detectAll();
    res.json({ tools });
  } catch (err: any) {
    console.error('Error detecting tools:', err);
    res.status(500).json({ error: err.message || 'Failed to detect tools' });
  }
});

// GET /api/tools/system-info — system prerequisites
router.get('/system-info', async (_req: Request, res: Response) => {
  try {
    const info = await toolManager.getSystemInfo();
    res.json(info);
  } catch (err: any) {
    console.error('Error getting system info:', err);
    res.status(500).json({ error: err.message || 'Failed to get system info' });
  }
});

// GET /api/tools/:toolId/status — detect a specific tool
router.get('/:toolId/status', async (req: Request<{ toolId: string }>, res: Response) => {
  try {
    const tool = await toolManager.detect(req.params.toolId);
    res.json(tool);
  } catch (err: any) {
    console.error('Error detecting tool:', err);
    res.status(500).json({ error: err.message || 'Failed to detect tool' });
  }
});

// POST /api/tools/:toolId/install — install a tool (blocks until complete)
// Used by the wizard which can't use Socket.IO
router.post('/:toolId/install', async (req: Request<{ toolId: string }>, res: Response) => {
  try {
    const { toolId } = req.params;
    await new Promise<void>((resolve, reject) => {
      toolManager.install(toolId, {
        onData: () => {},
        onComplete: (success, error) => {
          if (success) resolve();
          else reject(new Error(error || 'Installation failed'));
        },
      });
    });
    const tool = await toolManager.detect(toolId);
    res.json({ success: true, tool });
  } catch (err: any) {
    console.error('Error installing tool:', err);
    res.status(500).json({ error: err.message || 'Failed to install tool' });
  }
});

// ── Permissions ──

// GET /api/tools/permissions — detect all system permissions
router.get('/permissions', async (_req: Request, res: Response) => {
  try {
    const report = await permissionManager.detectPermissions();
    res.json(report);
  } catch (err: any) {
    console.error('Error detecting permissions:', err);
    res.status(500).json({ error: err.message || 'Failed to detect permissions' });
  }
});

// POST /api/tools/permissions/open-settings — open system settings pane
router.post('/permissions/open-settings', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const success = await permissionManager.openSettings(url);
  res.json({ success });
});

// POST /api/tools/permissions/request-sleep-prevention — prompt for admin to enable pmset disablesleep
router.post('/permissions/request-sleep-prevention', async (_req: Request, res: Response) => {
  try {
    const result = await permissionManager.requestSleepPrevention();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, output: err.message || 'Failed' });
  }
});

// POST /api/tools/permissions/revoke-sleep-prevention — uninstall the sleep prevention daemon
router.post('/permissions/revoke-sleep-prevention', async (_req: Request, res: Response) => {
  try {
    const result = await permissionManager.revokeSleepPrevention();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, output: err.message || 'Failed' });
  }
});

// POST /api/tools/permissions/run-command — run a permission-granting command
router.post('/permissions/run-command', async (req: Request, res: Response) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'command is required' });
  }
  const result = await permissionManager.runCommand(command);
  res.json(result);
});

export default router;
