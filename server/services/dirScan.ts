import fs from 'fs/promises';
import path from 'path';

const HEAVY_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', '.turbo',
  '.parcel-cache', '.svelte-kit', 'target', 'venv', '.venv', '__pycache__',
  '.idea', '.vscode', 'coverage', '.pytest_cache', '.mypy_cache',
  'out', '.output', 'tmp', '.tmp',
]);

const SECRET_FILE_NAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  '.env.test', '.env.staging',
]);

const HEAVY_DIR_BYTES = 50 * 1024 * 1024; // 50MB
const HEAVY_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  fileCount: number;
  suggestedExclude: boolean;
}

export interface DirScanResult {
  path: string;
  entries: DirEntry[];
  totalSize: number;
  totalFiles: number;
  truncated?: boolean;
}

const MAX_FILES_PER_DIR = 100_000;

async function getDirSize(dirPath: string, budget: { remaining: number }): Promise<{ size: number; fileCount: number }> {
  let size = 0;
  let fileCount = 0;
  if (budget.remaining <= 0) return { size, fileCount };
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return { size, fileCount };
  }
  for (const entry of entries) {
    if (budget.remaining <= 0) break;
    if (entry.name === '.git') continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const child = await getDirSize(full, budget);
      size += child.size;
      fileCount += child.fileCount;
    } else if (entry.isFile()) {
      try {
        const s = await fs.stat(full);
        size += s.size;
        fileCount += 1;
        budget.remaining -= 1;
      } catch {
        // skip
      }
    }
  }
  return { size, fileCount };
}

export async function scanDir(rootPath: string, relPath: string = ''): Promise<DirScanResult> {
  const safeRel = relPath.replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '');
  const target = path.resolve(rootPath, safeRel);
  if (!target.startsWith(path.resolve(rootPath))) {
    return { path: safeRel, entries: [], totalSize: 0, totalFiles: 0 };
  }
  let dirEntries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    dirEntries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return { path: safeRel, entries: [], totalSize: 0, totalFiles: 0 };
  }
  const entries: DirEntry[] = [];
  let totalSize = 0;
  let totalFiles = 0;
  let truncated = false;
  for (const entry of dirEntries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === '.git' && safeRel === '') continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const budget = { remaining: MAX_FILES_PER_DIR };
      const child = await getDirSize(full, budget);
      if (budget.remaining <= 0) truncated = true;
      const suggested = HEAVY_DIR_NAMES.has(entry.name) || child.size > HEAVY_DIR_BYTES;
      entries.push({
        name: entry.name,
        isDir: true,
        size: child.size,
        fileCount: child.fileCount,
        suggestedExclude: suggested,
      });
      totalSize += child.size;
      totalFiles += child.fileCount;
    } else if (entry.isFile()) {
      try {
        const s = await fs.stat(full);
        const suggested = SECRET_FILE_NAMES.has(entry.name) || s.size > HEAVY_FILE_BYTES;
        entries.push({
          name: entry.name,
          isDir: false,
          size: s.size,
          fileCount: 1,
          suggestedExclude: suggested,
        });
        totalSize += s.size;
        totalFiles += 1;
      } catch {
        // skip
      }
    }
  }
  // Sort: directories before files; within each group, larger first
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return b.size - a.size;
  });
  return { path: safeRel, entries, totalSize, totalFiles, truncated };
}

export default { scanDir };
