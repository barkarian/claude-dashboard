import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';

async function clone(repoUrl, targetPath) {
  const git = simpleGit();
  await git.clone(repoUrl, targetPath);
}

async function init(targetPath) {
  const git = simpleGit(targetPath);
  await git.init();
}

async function getDiff(projectPath) {
  const git = simpleGit(projectPath);

  try {
    const diffSummary = await git.diffSummary();
    const rawDiff = await git.diff();
    const status = await git.status();

    const files = [];

    for (const file of diffSummary.files) {
      const fileDiff = await git.diff(['--', file.file]);
      files.push({
        path: file.file,
        status: 'modified',
        additions: file.insertions,
        deletions: file.deletions,
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

async function revertFile(projectPath, filePath) {
  const git = simpleGit(projectPath);
  const status = await git.status();

  if (status.not_added.includes(filePath)) {
    await fs.unlink(path.join(projectPath, filePath));
  } else {
    await git.checkout(['--', filePath]);
  }
}

async function revertAll(projectPath) {
  const git = simpleGit(projectPath);
  await git.checkout(['--', '.']);
  await git.clean('f', ['-d']);
}

async function commitAll(projectPath, message) {
  const git = simpleGit(projectPath);
  await git.add('-A');
  await git.commit(message);
}

async function getStatus(projectPath) {
  const git = simpleGit(projectPath);
  const status = await git.status();

  const files = [];
  for (const file of status.modified) files.push({ path: file, status: 'modified' });
  for (const file of status.created) files.push({ path: file, status: 'added' });
  for (const file of status.deleted) files.push({ path: file, status: 'deleted' });
  for (const file of status.not_added) files.push({ path: file, status: 'untracked' });
  for (const file of status.renamed) files.push({ path: file.to, status: 'renamed' });

  return files;
}

export default {
  clone,
  init,
  getDiff,
  revertFile,
  revertAll,
  commitAll,
  getStatus,
};
