import simpleGit, { CheckRepoActions } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import type { DiffResult, DiffFile, GitRemote, GitLogEntry, BranchList, RepoInfo } from '../../shared/types/models.ts';

async function clone(repoUrl: string, targetPath: string): Promise<void> {
  const git = simpleGit();
  await git.clone(repoUrl, targetPath);
}

async function init(targetPath: string): Promise<void> {
  const git = simpleGit(targetPath);
  await git.init();
}

async function getDiff(projectPath: string): Promise<DiffResult> {
  const git = simpleGit(projectPath);

  try {
    const diffSummary = await git.diffSummary();
    const rawDiff = await git.diff();
    const status = await git.status();

    const files: DiffFile[] = [];

    for (const file of diffSummary.files) {
      const fileDiff = await git.diff(['--', file.file]);
      files.push({
        path: file.file,
        status: 'modified',
        additions: 'insertions' in file ? file.insertions : 0,
        deletions: 'deletions' in file ? file.deletions : 0,
        diff: fileDiff,
      });
    }

    // Add untracked files
    for (const file of status.not_added) {
      try {
        const content = await fs.readFile(path.join(projectPath, file), 'utf-8');
        files.push({
          path: file,
          status: 'added',
          additions: content.split('\n').length,
          deletions: 0,
          diff: `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${content.split('\n').length} @@\n${content.split('\n').map(l => '+' + l).join('\n')}`,
        });
      } catch {
        // Binary file or read error
        files.push({
          path: file,
          status: 'added',
          additions: 0,
          deletions: 0,
          diff: 'Binary file',
        });
      }
    }

    // Add staged files
    for (const file of status.created) {
      if (!files.find(f => f.path === file)) {
        files.push({
          path: file,
          status: 'added',
          additions: 0,
          deletions: 0,
          diff: '',
        });
      }
    }

    for (const file of status.deleted) {
      if (!files.find(f => f.path === file)) {
        files.push({
          path: file,
          status: 'deleted',
          additions: 0,
          deletions: 0,
          diff: '',
        });
      }
    }

    return { files, rawDiff };
  } catch (err) {
    console.error('getDiff error:', err);
    return { files: [], rawDiff: '' };
  }
}

async function revertFile(projectPath: string, filePath: string): Promise<void> {
  const git = simpleGit(projectPath);
  const status = await git.status();

  if (status.not_added.includes(filePath)) {
    await fs.unlink(path.join(projectPath, filePath));
  } else {
    await git.checkout(['--', filePath]);
  }
}

async function revertAll(projectPath: string): Promise<void> {
  const git = simpleGit(projectPath);
  await git.checkout(['--', '.']);
  await git.clean('f', ['-d']);
}

async function commitAll(projectPath: string, message: string): Promise<void> {
  const git = simpleGit(projectPath);
  await git.add('-A');
  await git.commit(message);
}

interface StatusFile {
  path: string;
  status: string;
}

async function getStatus(projectPath: string): Promise<StatusFile[]> {
  const git = simpleGit(projectPath);
  const status = await git.status();

  const files: StatusFile[] = [];
  for (const file of status.modified) files.push({ path: file, status: 'modified' });
  for (const file of status.created) files.push({ path: file, status: 'added' });
  for (const file of status.deleted) files.push({ path: file, status: 'deleted' });
  for (const file of status.not_added) files.push({ path: file, status: 'untracked' });
  for (const file of status.renamed) files.push({ path: file.to, status: 'renamed' });

  return files;
}

async function checkIsRepo(targetPath: string): Promise<boolean> {
  const git = simpleGit(targetPath);
  return git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
}

async function getRemotes(targetPath: string): Promise<GitRemote[]> {
  const git = simpleGit(targetPath);
  const remotes = await git.getRemotes(true);
  return remotes.map((r) => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }));
}

async function addRemote(targetPath: string, name: string, url: string): Promise<void> {
  const git = simpleGit(targetPath);
  await git.addRemote(name, url);
}

async function getLog(targetPath: string, maxCount = 20): Promise<GitLogEntry[]> {
  const git = simpleGit(targetPath);
  try {
    const log = await git.log({ maxCount, '--stat': null } as any);
    return log.all.map((entry) => {
      // Parse stat from diff field (e.g. "3 files changed, 10 insertions(+), 5 deletions(-)")
      const diff = (entry as any).diff || {};
      const files = diff.files || [];
      let additions = 0;
      let deletions = 0;
      for (const f of files) {
        additions += f.insertions || 0;
        deletions += f.deletions || 0;
      }
      return {
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        message: entry.message,
        author: entry.author_name,
        date: entry.date,
        filesChanged: files.length,
        additions,
        deletions,
      };
    });
  } catch {
    // Empty repo with no commits
    return [];
  }
}

async function getCurrentBranch(targetPath: string): Promise<string | null> {
  const git = simpleGit(targetPath);
  const status = await git.status();
  return status.current;
}

async function getUnpushedCount(targetPath: string): Promise<number> {
  const git = simpleGit(targetPath);
  try {
    const remotes = await git.getRemotes();
    if (remotes.length === 0) return 0;
    // Fetch to make sure we have latest remote refs
    try { await git.fetch(); } catch { /* offline is fine */ }
    const log = await git.log(['@{u}..HEAD']);
    return log.total;
  } catch {
    // No upstream set or other error
    return 0;
  }
}

async function push(targetPath: string): Promise<void> {
  const git = simpleGit(targetPath);
  const status = await git.status();
  const branch = status.current;
  if (!branch) throw new Error('No current branch');
  // Try push; if no upstream, set it
  try {
    await git.push();
  } catch {
    await git.push(['-u', 'origin', branch]);
  }
}

async function listBranches(targetPath: string): Promise<BranchList> {
  const git = simpleGit(targetPath);
  const local = await git.branchLocal();
  const remote = await git.branch(['-r']);
  // Filter remote branches: remove HEAD pointers, strip 'origin/' prefix
  const remoteNames = remote.all
    .filter(b => !b.includes('HEAD'))
    .map(b => b.replace(/^origin\//, ''));
  // Only include remote branches that don't exist locally
  const localSet = new Set(local.all);
  const remoteOnly = remoteNames.filter(b => !localSet.has(b));
  return { current: local.current || null, local: local.all, remote: remoteOnly };
}

async function checkoutBranch(targetPath: string, name: string): Promise<void> {
  const git = simpleGit(targetPath);
  const local = await git.branchLocal();
  if (local.all.includes(name)) {
    await git.checkout(name);
  } else {
    // Create local tracking branch from remote
    await git.checkout(['-b', name, `origin/${name}`]);
  }
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.cache',
  '__pycache__', '.venv', 'venv', '.env', 'coverage', '.claude-dashboard',
]);

async function discoverRepos(projectPath: string): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];

  async function hasGitDir(dir: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(dir, '.git'));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async function scanLevel(dir: string, depth: number): Promise<void> {
    if (await hasGitDir(dir)) {
      const rel = path.relative(projectPath, dir);
      const name = rel || '.';
      try {
        const files = await getStatus(dir);
        repos.push({ repoPath: dir, name, changeCount: files.length });
      } catch {
        repos.push({ repoPath: dir, name, changeCount: 0 });
      }
    }

    if (depth >= 2) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
        await scanLevel(path.join(dir, entry.name), depth + 1);
      }
    } catch {
      // Permission error or similar
    }
  }

  await scanLevel(projectPath, 0);

  // Sort: root first, then alphabetically
  repos.sort((a, b) => {
    if (a.name === '.') return -1;
    if (b.name === '.') return 1;
    return a.name.localeCompare(b.name);
  });

  return repos;
}

async function hasUncommittedChanges(targetPath: string): Promise<boolean> {
  const git = simpleGit(targetPath);
  const status = await git.status();
  return !status.isClean();
}

export default {
  clone,
  init,
  getDiff,
  revertFile,
  revertAll,
  commitAll,
  getStatus,
  checkIsRepo,
  getRemotes,
  addRemote,
  getLog,
  getCurrentBranch,
  getUnpushedCount,
  push,
  listBranches,
  checkoutBranch,
  hasUncommittedChanges,
  discoverRepos,
};
