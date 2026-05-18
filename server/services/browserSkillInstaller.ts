/**
 * browserSkillInstaller — install/uninstall Microsoft's official playwright-cli
 * skill into a project's `.claude/skills/playwright-cli/` directory, plus
 * register `Bash(playwright-cli:*)` in the project's `.claude/settings.json`.
 *
 * Idempotent both ways. Vendors the skill byte-identical from node_modules,
 * so we don't fork upstream.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundled @playwright/cli skill source dir. */
function getSkillSourceDir(): string {
  // server/services/browserSkillInstaller.ts → server/node_modules/...
  return path.join(__dirname, '..', 'node_modules', '@playwright', 'cli', 'skills', 'playwright-cli');
}

function readJsonSafe(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file: string, data: any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** Ensure `.claude/settings.json` has a `permissions.allow` entry for the
 *  given Bash pattern. Other settings are left untouched. */
function ensurePermission(projectPath: string, pattern: string): void {
  const file = path.join(projectPath, '.claude', 'settings.json');
  const cfg = readJsonSafe(file) || {};
  cfg.permissions = cfg.permissions || {};
  cfg.permissions.allow = Array.isArray(cfg.permissions.allow) ? cfg.permissions.allow : [];
  if (!cfg.permissions.allow.includes(pattern)) {
    cfg.permissions.allow.push(pattern);
  }
  writeJsonAtomic(file, cfg);
}

/** Inverse: remove the given Bash pattern from `permissions.allow`. */
function removePermission(projectPath: string, pattern: string): void {
  const file = path.join(projectPath, '.claude', 'settings.json');
  const cfg = readJsonSafe(file);
  if (!cfg?.permissions?.allow) return;
  cfg.permissions.allow = cfg.permissions.allow.filter((p: any) => p !== pattern);
  if (cfg.permissions.allow.length === 0) delete cfg.permissions.allow;
  if (Object.keys(cfg.permissions).length === 0) delete cfg.permissions;
  if (Object.keys(cfg).length === 0) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  } else {
    writeJsonAtomic(file, cfg);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Drop a `.gitignore` *inside* the directory that ignores everything except
 * itself. Lets us keep machine-local / runtime contents out of git without
 * touching the user's root `.gitignore`. The .gitignore itself is committed
 * once (so the directory survives `git clean -fd`); everything else stays
 * invisible.
 */
function writeNestedGitignore(dir: string, headerComment: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const body =
    `${headerComment}\n` +
    `# Ignore everything in this directory except this file itself.\n` +
    `*\n` +
    `!.gitignore\n`;
  fs.writeFileSync(path.join(dir, '.gitignore'), body);
}

export interface InstallResult {
  installed: boolean;
  skillDir: string;
  reason?: string;
}

/**
 * Install the playwright-cli skill into a project.
 * @returns InstallResult with `installed: true` if files were written.
 */
export function installBrowserSkill(projectPath: string): InstallResult {
  const sourceDir = getSkillSourceDir();
  if (!fs.existsSync(sourceDir)) {
    return { installed: false, skillDir: '', reason: 'skill source not found in node_modules' };
  }
  const destDir = path.join(projectPath, '.claude', 'skills', 'playwright-cli');
  copyDirRecursive(sourceDir, destDir);
  ensurePermission(projectPath, 'Bash(playwright-cli:*)');

  // Drop nested .gitignore files so the skill content + the CLI's runtime
  // artifacts don't pollute the user's git status. Skill files are
  // machine-local (managed by the dashboard toggle); .playwright-cli/ holds
  // ephemeral snapshots, screenshots, and logs the agent writes per turn.
  writeNestedGitignore(
    destDir,
    '# Playwright skill installed by the dashboard Browser toggle.\n' +
    '# Machine-local — re-installed automatically when the toggle is on.',
  );
  writeNestedGitignore(
    path.join(projectPath, '.playwright-cli'),
    '# Runtime artifacts written by playwright-cli (snapshots, screenshots,\n' +
    '# console logs, videos). Never commit these.',
  );

  return { installed: true, skillDir: destDir };
}

/**
 * Remove the playwright-cli skill from a project. Safe to call when not
 * installed.
 */
export function uninstallBrowserSkill(projectPath: string): void {
  const destDir = path.join(projectPath, '.claude', 'skills', 'playwright-cli');
  try {
    fs.rmSync(destDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  // If skills dir is now empty, drop it too — keep the user's repo tidy.
  try {
    const skillsParent = path.join(projectPath, '.claude', 'skills');
    if (fs.readdirSync(skillsParent).length === 0) fs.rmdirSync(skillsParent);
  } catch { /* ignore */ }
  removePermission(projectPath, 'Bash(playwright-cli:*)');
}

export default { installBrowserSkill, uninstallBrowserSkill };
