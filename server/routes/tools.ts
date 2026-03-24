import { Router, type Request, type Response } from 'express';
import toolManager from '../services/toolManager.ts';

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

export default router;
