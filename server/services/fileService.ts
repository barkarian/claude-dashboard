import fs from 'fs/promises';
import path from 'path';
import ignore, { type Ignore } from 'ignore';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Server as SocketIOServer } from 'socket.io';
import gitService from './gitService.ts';

interface CacheEntry {
  files: string[];
  timestamp: number;
}

const fileCache = new Map<string, CacheEntry>();
const watchers = new Map<string, FSWatcher>();

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.claude-dashboard',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  '.DS_Store',
  'Thumbs.db',
  '*.pyc',
  '*.pyo',
  '*.class',
  '*.o',
  '*.so',
  '*.dylib',
];

async function loadGitignore(projectPath: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  try {
    const gitignoreContent = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch {
    // No .gitignore, use defaults only
  }

  return ig;
}

async function walkDir(dir: string, baseDir: string, ig: Ignore, results: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (ig.ignores(relativePath)) continue;

    if (entry.isDirectory()) {
      await walkDir(fullPath, baseDir, ig, results);
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }

  return results;
}

async function listProjectFiles(projectPath: string): Promise<string[]> {
  const cached = fileCache.get(projectPath);
  if (cached && Date.now() - cached.timestamp < 10000) {
    return cached.files;
  }

  const ig = await loadGitignore(projectPath);
  const files = await walkDir(projectPath, projectPath, ig);

  fileCache.set(projectPath, { files, timestamp: Date.now() });
  return files;
}

function resolveAndGuard(projectPath: string, relativePath: string): string {
  const fullPath = path.join(projectPath, relativePath);
  const resolved = path.resolve(fullPath);
  const resolvedBase = path.resolve(projectPath);
  if (!resolved.startsWith(resolvedBase)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

async function getFileStat(projectPath: string, relativePath: string): Promise<{ size: number }> {
  const fullPath = resolveAndGuard(projectPath, relativePath);
  const stat = await fs.stat(fullPath);
  return { size: stat.size };
}

async function getFileContent(projectPath: string, relativePath: string): Promise<string> {
  const fullPath = resolveAndGuard(projectPath, relativePath);
  return fs.readFile(fullPath, 'utf-8');
}

// Batched file event state
const eventBatches = new Map<string, Array<{ event: string; path: string }>>();
const batchTimers = new Map<string, NodeJS.Timeout>();

// Allowlist of .git/ entries that indicate a repo-state change we care about
// (commit, checkout, fetch, reset, branch/tag updates). Other files under .git/
// (objects/, logs/, hooks/, lock files, etc.) are ignored to avoid noise.
const GIT_META_FILES = new Set(['HEAD', 'index', 'MERGE_HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'packed-refs']);

function isInsideGitDir(filePath: string): boolean {
  return filePath.includes(`${path.sep}.git${path.sep}`) || filePath.endsWith(`${path.sep}.git`);
}

function shouldIgnore(filePath: string): boolean {
  if (filePath.includes(`${path.sep}node_modules${path.sep}`)) return true;
  if (filePath.includes(`${path.sep}.claude-dashboard${path.sep}`)) return true;
  if (filePath.endsWith(`${path.sep}.DS_Store`)) return true;

  const gitSegment = `${path.sep}.git${path.sep}`;
  const idx = filePath.lastIndexOf(gitSegment);
  if (idx === -1) return false; // not under .git/, allow
  const inside = filePath.substring(idx + gitSegment.length);
  // Allow HEAD, index, etc., and anything under refs/
  if (GIT_META_FILES.has(inside)) return false;
  if (inside === 'refs' || inside.startsWith(`refs${path.sep}`)) return false;
  return true;
}

function queueFileEvent(projectId: string, projectPath: string, io: SocketIOServer, event: string, filePath: string): void {
  const isGitMeta = isInsideGitDir(filePath);

  if (!isGitMeta) {
    if (event === 'add' || event === 'unlink') {
      fileCache.delete(projectPath);
    }
    const relativePath = path.relative(projectPath, filePath);
    if (!eventBatches.has(projectId)) {
      eventBatches.set(projectId, []);
    }
    eventBatches.get(projectId)!.push({ event, path: relativePath });
  }

  // Reset debounce timer (500ms quiet period)
  if (batchTimers.has(projectId)) {
    clearTimeout(batchTimers.get(projectId));
  }

  batchTimers.set(projectId, setTimeout(() => {
    const batch = eventBatches.get(projectId) || [];
    eventBatches.delete(projectId);
    batchTimers.delete(projectId);

    const room = `project:${projectId}`;
    if (batch.length > 0) {
      if (batch.length > 20) {
        io.to(room).emit('files:refresh', { projectId });
      } else {
        io.to(room).emit('files:changed-batch', { projectId, changes: batch });
      }
    }

    // Always recompute repo change counts — covers both working-tree edits
    // and .git/ metadata changes (external commits, pushes, checkouts).
    gitService.discoverRepos(projectPath).then(repos => {
      const totalChangeCount = repos.reduce((sum, r) => sum + r.changeCount, 0);
      io.to(room).emit('repos:change-counts', { projectId, repos, totalChangeCount });
    }).catch(() => {});
  }, 500));
}

function startWatching(projectPath: string, projectId: string, io: SocketIOServer): void {
  if (watchers.has(projectId)) return;

  const watcher = chokidar.watch(projectPath, {
    ignored: (p: string) => shouldIgnore(p),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath: string) => {
    queueFileEvent(projectId, projectPath, io, 'add', filePath);
  });

  watcher.on('change', (filePath: string) => {
    queueFileEvent(projectId, projectPath, io, 'change', filePath);
  });

  watcher.on('unlink', (filePath: string) => {
    queueFileEvent(projectId, projectPath, io, 'unlink', filePath);
  });

  watchers.set(projectId, watcher);
}

function stopWatching(projectId: string): void {
  const watcher = watchers.get(projectId);
  if (watcher) {
    watcher.close();
    watchers.delete(projectId);
  }
}

function stopAllWatching(): void {
  for (const [projectId] of watchers) {
    stopWatching(projectId);
  }
}

export default {
  listProjectFiles,
  getFileStat,
  getFileContent,
  startWatching,
  stopWatching,
  stopAllWatching,
};
