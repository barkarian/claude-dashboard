import { Router, type Request, type Response } from 'express';
import { execSync, exec } from 'child_process';
import config from '../config.ts';

const router = Router();

const PROTECTED_PORTS = new Set([config.port]);

interface PortEntry {
  port: number;
  pid: number;
  process: string;
  protocol: string;
  protected: boolean;
}

// GET /api/system/ports — list all listening ports
router.get('/ports', async (_req: Request, res: Response) => {
  try {
    // macOS: use lsof to list listening TCP ports
    const raw = execSync(
      `lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 10000 },
    );

    const seen = new Map<number, PortEntry>();

    for (const line of raw.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const processName = parts[0];
      const pid = parseInt(parts[1], 10);
      const nameField = parts[8]; // e.g. *:3000 or 127.0.0.1:8080

      const portMatch = nameField.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = parseInt(portMatch[1], 10);
      if (isNaN(port)) continue;

      // Deduplicate by port (keep first entry)
      if (!seen.has(port)) {
        seen.set(port, {
          port,
          pid,
          process: processName,
          protocol: 'tcp',
          protected: PROTECTED_PORTS.has(port),
        });
      }
    }

    const ports = Array.from(seen.values()).sort((a, b) => a.port - b.port);
    res.json({ ports });
  } catch (err: any) {
    console.error('Failed to list ports:', err);
    res.status(500).json({ error: 'Failed to list open ports' });
  }
});

// POST /api/system/ports/:port/kill — kill the process listening on a port
router.post('/ports/:port/kill', async (req: Request, res: Response) => {
  const port = parseInt(req.params.port, 10);
  if (isNaN(port)) {
    return res.status(400).json({ error: 'Invalid port number' });
  }

  if (PROTECTED_PORTS.has(port)) {
    return res.status(403).json({ error: `Port ${port} is protected and cannot be killed` });
  }

  try {
    // Find PIDs listening on this port
    const raw = execSync(
      `lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();

    if (!raw) {
      return res.status(404).json({ error: `No process found on port ${port}` });
    }

    const pids = raw.split('\n').map(p => p.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 5000 });
      } catch {
        // Process may have already exited
      }
    }

    res.json({ success: true, port, killedPids: pids.map(Number) });
  } catch (err: any) {
    console.error(`Failed to kill port ${port}:`, err);
    res.status(500).json({ error: `Failed to kill process on port ${port}` });
  }
});

// POST /api/system/shutdown — shut down the computer
router.post('/shutdown', async (_req: Request, res: Response) => {
  // Send response BEFORE initiating shutdown so the client gets confirmation
  res.json({ success: true, message: 'Shutdown initiated' });

  // Give the response time to flush, then shutdown
  setTimeout(() => {
    const platform = process.platform;
    try {
      if (platform === 'darwin') {
        // macOS: osascript for immediate shutdown (no confirmation dialog)
        exec('osascript -e \'tell app "System Events" to shut down\'');
      } else if (platform === 'linux') {
        exec('sudo shutdown -h now');
      } else if (platform === 'win32') {
        exec('shutdown /s /t 0');
      }
    } catch (err) {
      console.error('Shutdown command failed:', err);
    }
  }, 1000);
});

export default router;
