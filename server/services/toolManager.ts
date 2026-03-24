import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  binaryPath?: string;
  installCommand: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string | null;
  npmVersion: string | null;
  gitVersion: string | null;
  shell: string;
  homeDir: string;
}

const TOOLS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic\'s official CLI for Claude — run Claude in your terminal',
    binary: 'claude',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'claude-agent-sdk',
    name: 'Claude Agent SDK',
    description: 'Build custom AI agents with the Claude Agent SDK',
    binary: 'claude-agent',
    // The SDK is an npm package, check via npm list
    installCommand: 'npm install -g @anthropic-ai/claude-code-agent-sdk',
  },
  {
    id: 'opencode',
    name: 'Open Code',
    description: 'Open-source AI coding assistant CLI',
    binary: 'opencode',
    installCommand: 'npm install -g opencode-ai',
  },
] as const;

/** Cross-platform which/where */
async function which(binary: string): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(cmd, [binary], { timeout: 5000 });
    const result = stdout.trim().split('\n')[0]?.trim();
    return result || null;
  } catch {
    return null;
  }
}

/** Run binary --version and extract version string */
async function getVersion(binary: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--version'], { timeout: 10000 });
    const output = (stdout || stderr).trim();
    // Extract version-like pattern (e.g. "1.2.3", "v1.2.3")
    const match = output.match(/v?(\d+\.\d+\.\d+[^\s]*)/);
    return match ? match[1] : output.split('\n')[0];
  } catch {
    return null;
  }
}

/** Check for npm global package (for SDK which may not have a binary) */
async function checkNpmGlobal(packageName: string): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync('npm', ['list', '-g', packageName, '--depth=0', '--json'], { timeout: 15000 });
    const data = JSON.parse(stdout);
    const deps = data.dependencies || {};
    if (deps[packageName]) {
      return { installed: true, version: deps[packageName].version };
    }
    return { installed: false };
  } catch {
    return { installed: false };
  }
}

/** Detect a single tool */
async function detect(toolId: string): Promise<ToolInfo> {
  const tool = TOOLS.find(t => t.id === toolId);
  if (!tool) throw new Error(`Unknown tool: ${toolId}`);

  // For claude-agent-sdk, check via npm since it's a library
  if (toolId === 'claude-agent-sdk') {
    const npmCheck = await checkNpmGlobal('@anthropic-ai/claude-code-agent-sdk');
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      installed: npmCheck.installed,
      version: npmCheck.version,
      installCommand: tool.installCommand,
    };
  }

  // For tools with binaries, use which + --version
  const binaryPath = await which(tool.binary);
  if (!binaryPath) {
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      installed: false,
      installCommand: tool.installCommand,
    };
  }

  const version = await getVersion(binaryPath);
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    installed: true,
    version: version || undefined,
    binaryPath,
    installCommand: tool.installCommand,
  };
}

/** Detect all tools */
async function detectAll(): Promise<ToolInfo[]> {
  return Promise.all(TOOLS.map(t => detect(t.id)));
}

/** Get system info */
async function getSystemInfo(): Promise<SystemInfo> {
  const [nodeVersion, npmVersion, gitVersion] = await Promise.all([
    getVersion('node'),
    getVersion('npm'),
    getVersion('git'),
  ]);

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion,
    npmVersion,
    gitVersion,
    shell: process.env.SHELL || (process.platform === 'win32' ? 'powershell' : '/bin/sh'),
    homeDir: os.homedir(),
  };
}

// Active installation jobs
const activeJobs = new Map<string, ChildProcess>();

interface InstallCallbacks {
  onData: (data: string) => void;
  onComplete: (success: boolean, error?: string) => void;
}

/** Install a tool, streaming output via callbacks */
function install(toolId: string, callbacks: InstallCallbacks): string {
  const tool = TOOLS.find(t => t.id === toolId);
  if (!tool) throw new Error(`Unknown tool: ${toolId}`);

  // Kill any existing job for this tool
  const existing = activeJobs.get(toolId);
  if (existing) {
    existing.kill();
    activeJobs.delete(toolId);
  }

  const jobId = `${toolId}-${Date.now()}`;
  const [cmd, ...args] = tool.installCommand.split(' ');

  const child = spawn(cmd, args, {
    shell: true,
    env: { ...process.env, TERM: 'xterm-256color' },
    cwd: os.homedir(),
  });

  activeJobs.set(toolId, child);

  child.stdout?.on('data', (data: Buffer) => {
    callbacks.onData(data.toString());
  });

  child.stderr?.on('data', (data: Buffer) => {
    callbacks.onData(data.toString());
  });

  child.on('close', (code) => {
    activeJobs.delete(toolId);
    if (code === 0) {
      callbacks.onComplete(true);
    } else {
      callbacks.onComplete(false, `Installation exited with code ${code}`);
    }
  });

  child.on('error', (err) => {
    activeJobs.delete(toolId);
    callbacks.onComplete(false, err.message);
  });

  return jobId;
}

/** Cancel an active installation */
function cancelInstall(toolId: string): boolean {
  const child = activeJobs.get(toolId);
  if (child) {
    child.kill();
    activeJobs.delete(toolId);
    return true;
  }
  return false;
}

/** Get list of known tool IDs */
function getToolIds(): string[] {
  return TOOLS.map(t => t.id);
}

export default {
  detect,
  detectAll,
  getSystemInfo,
  install,
  cancelInstall,
  getToolIds,
};
