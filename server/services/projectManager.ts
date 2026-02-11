import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.ts';
import gitService from './gitService.ts';
import type { Project, ProjectSummary } from '../../shared/types/models.ts';

const CONFIG_DIR = '.claude-dashboard';
const CONFIG_FILE = 'config.json';

const writeLocks = new Map<string, boolean>();

async function withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  while (writeLocks.get(projectId)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  writeLocks.set(projectId, true);
  try {
    return await fn();
  } finally {
    writeLocks.delete(projectId);
  }
}

function getProjectPath(projectId: string): string {
  return path.join(config.projectsBasePath, projectId);
}

function getConfigPath(projectId: string): string {
  return path.join(getProjectPath(projectId), CONFIG_DIR, CONFIG_FILE);
}

async function readConfig(projectId: string): Promise<Project | null> {
  try {
    const data = await fs.readFile(getConfigPath(projectId), 'utf-8');
    return JSON.parse(data) as Project;
  } catch {
    return null;
  }
}

async function writeConfig(projectId: string, configData: Project): Promise<void> {
  const configDir = path.join(getProjectPath(projectId), CONFIG_DIR);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getConfigPath(projectId), JSON.stringify(configData, null, 2));
}

async function listProjects(): Promise<ProjectSummary[]> {
  try {
    await fs.mkdir(config.projectsBasePath, { recursive: true });
    const entries = await fs.readdir(config.projectsBasePath, { withFileTypes: true });
    const projects: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const projectConfig = await readConfig(entry.name);
      if (projectConfig) {
        projects.push({
          id: projectConfig.id,
          name: projectConfig.name,
          repo: projectConfig.repo,
          createdAt: projectConfig.createdAt,
          scriptsCount: (projectConfig.scripts || []).length,
          chatsCount: (projectConfig.chats || []).length,
        });
      }
    }

    return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.error('Error listing projects:', err);
    return [];
  }
}

async function getProject(projectId: string): Promise<Project | null> {
  return readConfig(projectId);
}

async function createProject(name: string, repoUrl?: string): Promise<{ project: Project; setupSessionId: string }> {
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const projectPath = getProjectPath(id);

  await fs.mkdir(config.projectsBasePath, { recursive: true });

  // Check if directory already exists
  try {
    await fs.access(projectPath);
    // If it exists, append a UUID suffix
    const uniqueId = `${id}-${uuidv4().slice(0, 8)}`;
    return createProjectWithId(uniqueId, name, repoUrl);
  } catch {
    // Directory doesn't exist, proceed
  }

  return createProjectWithId(id, name, repoUrl);
}

async function createProjectWithId(id: string, name: string, repoUrl?: string): Promise<{ project: Project; setupSessionId: string }> {
  const projectPath = getProjectPath(id);

  if (repoUrl) {
    await gitService.clone(repoUrl, projectPath);
    // Append .claude-dashboard to existing .gitignore (or create one)
    const gitignorePath = path.join(projectPath, '.gitignore');
    try {
      const existing = await fs.readFile(gitignorePath, 'utf-8');
      if (!existing.split('\n').some(line => line.trim() === '.claude-dashboard')) {
        await fs.writeFile(gitignorePath, existing.trimEnd() + '\n.claude-dashboard\n');
      }
    } catch {
      await fs.writeFile(gitignorePath, '.claude-dashboard\n');
    }
  } else {
    await fs.mkdir(projectPath, { recursive: true });
    await gitService.init(projectPath);
    // Create .gitignore with .claude-dashboard
    await fs.writeFile(path.join(projectPath, '.gitignore'), '.claude-dashboard\n');
  }

  const projectConfig: Project = {
    id,
    name,
    repo: repoUrl || null,
    createdAt: new Date().toISOString(),
    scripts: [],
    chats: [],
  };

  await writeConfig(id, projectConfig);
  return { project: projectConfig, setupSessionId: uuidv4() };
}

async function updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
  return withLock(projectId, async () => {
    const current = await readConfig(projectId);
    if (!current) {
      throw new Error('Project not found');
    }
    const updated = { ...current, ...updates };
    await writeConfig(projectId, updated);
    return updated;
  });
}

async function deleteProject(projectId: string): Promise<void> {
  const projectPath = getProjectPath(projectId);
  try {
    await fs.rm(projectPath, { recursive: true, force: true });
  } catch (err) {
    console.error('Error deleting project directory:', err);
    throw err;
  }
}

export default {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectPath,
};
