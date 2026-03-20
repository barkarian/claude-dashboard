import simpleGit, { CheckRepoActions } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import type { DiffResult, DiffFile, GitRemote, GitLogEntry } from '../../shared/types/models.ts';

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
    const log = await git.log({ maxCount });
    return log.all.map((entry) => ({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
    }));
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
};
