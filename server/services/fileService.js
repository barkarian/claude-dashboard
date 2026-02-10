import fs from 'fs/promises';
import path from 'path';
import ignore from 'ignore';
import chokidar from 'chokidar';

const fileCache = new Map();
const watchers = new Map();

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

async function loadGitignore(projectPath) {
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

async function walkDir(dir, baseDir, ig, results = []) {
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

async function listProjectFiles(projectPath) {
  const cached = fileCache.get(projectPath);
  if (cached && Date.now() - cached.timestamp < 10000) {
    return cached.files;
  }

  const ig = await loadGitignore(projectPath);
  const files = await walkDir(projectPath, projectPath, ig);

  fileCache.set(projectPath, { files, timestamp: Date.now() });
  return files;
}

async function getFileContent(projectPath, relativePath) {
  const fullPath = path.join(projectPath, relativePath);
  // Security: ensure path is within project
  const resolved = path.resolve(fullPath);
  const resolvedBase = path.resolve(projectPath);
  if (!resolved.startsWith(resolvedBase)) {
    throw new Error('Path traversal detected');
  }
  return fs.readFile(fullPath, 'utf-8');
}

function startWatching(projectPath, projectId, io) {
  if (watchers.has(projectId)) return;

  const watcher = chokidar.watch(projectPath, {
    ignored: [
      /node_modules/,
      /\.git\//,
      /\.claude-dashboard/,
      /\.DS_Store/,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  const room = `project:${projectId}`;

  watcher.on('add', (filePath) => {
    fileCache.delete(projectPath);
    const relativePath = path.relative(projectPath, filePath);
    io.to(room).emit('files:changed', { projectId, event: 'add', path: relativePath });
  });

  watcher.on('change', (filePath) => {
    const relativePath = path.relative(projectPath, filePath);
    io.to(room).emit('files:changed', { projectId, event: 'change', path: relativePath });
  });

  watcher.on('unlink', (filePath) => {
    fileCache.delete(projectPath);
    const relativePath = path.relative(projectPath, filePath);
    io.to(room).emit('files:changed', { projectId, event: 'unlink', path: relativePath });
  });

  watchers.set(projectId, watcher);
}

function stopWatching(projectId) {
  const watcher = watchers.get(projectId);
  if (watcher) {
    watcher.close();
    watchers.delete(projectId);
  }
}

function stopAllWatching() {
  for (const [projectId] of watchers) {
    stopWatching(projectId);
  }
}

export default {
  listProjectFiles,
  getFileContent,
  startWatching,
  stopWatching,
  stopAllWatching,
};
