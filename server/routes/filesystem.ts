import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

// GET /api/filesystem/browse?path=/some/path
// Returns directories only, sorted alphabetically, hidden dirs excluded
router.get('/browse', (req, res) => {
  try {
    const targetPath = (req.query.path as string) || os.homedir();
    const resolved = path.resolve(targetPath);

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    let entries: { name: string; type: 'directory'; hasGit: boolean }[] = [];

    const items = fs.readdirSync(resolved);
    for (const name of items) {
      // Skip hidden directories
      if (name.startsWith('.')) continue;

      const fullPath = path.join(resolved, name);
      try {
        const itemStat = fs.statSync(fullPath);
        if (itemStat.isDirectory()) {
          const hasGit = fs.existsSync(path.join(fullPath, '.git'));
          entries.push({ name, type: 'directory', hasGit });
        }
      } catch {
        // Skip entries we can't stat (permission errors, etc.)
      }
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolved) !== resolved ? path.dirname(resolved) : null;

    res.json({
      currentPath: resolved,
      parentPath,
      entries,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
