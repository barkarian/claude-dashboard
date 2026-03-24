import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ── Types ──

export interface PermissionCheck {
  id: string;
  label: string;
  description: string;
  granted: boolean;
  /** What the user needs to do to grant/revoke */
  instructions: string;
  /** Platform-specific action: 'open_settings' | 'run_command' | 'manual' */
  actionType: 'open_settings' | 'run_command' | 'manual';
  /** For open_settings: the URL/command to open. For run_command: the command to run. */
  actionValue?: string;
  /** Category for grouping in the UI */
  category: 'filesystem' | 'execution' | 'agent';
}

export interface PermissionsReport {
  platform: string;
  permissions: PermissionCheck[];
}

// ── macOS checks ──

async function checkMacosFullDiskAccess(): Promise<boolean> {
  // TCC.db is only readable with Full Disk Access
  try {
    await fs.promises.access('/Library/Application Support/com.apple.TCC/TCC.db', fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkFolderAccess(folder: string): Promise<boolean> {
  const target = path.join(os.homedir(), folder);
  try {
    await fs.promises.readdir(target);
    return true;
  } catch {
    return false;
  }
}

async function checkMacosClaudeCodePermissions(): Promise<boolean> {
  // Check if Claude Code's settings allow skip-permissions
  const configPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');
    const settings = JSON.parse(content);
    // Check for allowedTools or permissions config
    return settings.permissions?.allow_all === true ||
           settings.autoApprove === true ||
           false;
  } catch {
    return false;
  }
}

async function checkMacosTerminalFDA(): Promise<boolean> {
  // Check if Terminal.app (or the current terminal emulator) has Full Disk Access
  // by trying to read a TCC-protected path
  try {
    await fs.promises.readdir('/Library/Application Support/com.apple.TCC');
    return true;
  } catch {
    return false;
  }
}

async function getMacosPermissions(): Promise<PermissionCheck[]> {
  const [fda, desktop, documents, downloads, terminalFda] = await Promise.all([
    checkMacosFullDiskAccess(),
    checkFolderAccess('Desktop'),
    checkFolderAccess('Documents'),
    checkFolderAccess('Downloads'),
    checkMacosTerminalFDA(),
  ]);

  const permissions: PermissionCheck[] = [
    {
      id: 'macos_full_disk_access',
      label: 'Full Disk Access',
      description: 'Allows agents to read/write any file on your Mac. Grants access to all directories without individual prompts.',
      granted: fda,
      instructions: fda
        ? 'Full Disk Access is granted. To revoke, open System Settings > Privacy & Security > Full Disk Access and toggle off this app.'
        : 'Open System Settings > Privacy & Security > Full Disk Access, click the + button, and add this application (Claw Dev or Terminal).',
      actionType: 'open_settings',
      actionValue: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      category: 'filesystem',
    },
    {
      id: 'macos_desktop',
      label: 'Desktop Folder Access',
      description: 'Access to ~/Desktop files',
      granted: fda || desktop,
      instructions: fda ? 'Covered by Full Disk Access.' : 'Grant via System Settings > Privacy & Security > Files & Folders.',
      actionType: 'open_settings',
      actionValue: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
      category: 'filesystem',
    },
    {
      id: 'macos_documents',
      label: 'Documents Folder Access',
      description: 'Access to ~/Documents files',
      granted: fda || documents,
      instructions: fda ? 'Covered by Full Disk Access.' : 'Grant via System Settings > Privacy & Security > Files & Folders.',
      actionType: 'open_settings',
      actionValue: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
      category: 'filesystem',
    },
    {
      id: 'macos_downloads',
      label: 'Downloads Folder Access',
      description: 'Access to ~/Downloads files',
      granted: fda || downloads,
      instructions: fda ? 'Covered by Full Disk Access.' : 'Grant via System Settings > Privacy & Security > Files & Folders.',
      actionType: 'open_settings',
      actionValue: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
      category: 'filesystem',
    },
    {
      id: 'macos_terminal_fda',
      label: 'Terminal Full Disk Access',
      description: 'The terminal running this server has Full Disk Access — agents can access all files when running commands.',
      granted: terminalFda,
      instructions: terminalFda
        ? 'Your terminal has Full Disk Access.'
        : 'Add your terminal app (Terminal, iTerm2, Warp, etc.) to System Settings > Privacy & Security > Full Disk Access.',
      actionType: 'open_settings',
      actionValue: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      category: 'execution',
    },
  ];

  // Check if sleep prevention is active (for the desktop app)
  try {
    const { stdout } = await execFileAsync('pmset', ['-g', 'assertions']);
    const sleepDisabled = stdout.includes('PreventUserIdleSystemSleep') || stdout.includes('disablesleep');
    permissions.push({
      id: 'macos_sleep_prevention',
      label: 'Sleep Prevention',
      description: 'Prevents Mac from sleeping while the app is running, keeping tunnels and agents active.',
      granted: sleepDisabled,
      instructions: sleepDisabled
        ? 'Sleep prevention is active. The Mac will stay awake while the app runs.'
        : 'Sleep prevention is handled automatically by the Claw Dev desktop app. If running in terminal mode, use: caffeinate -s',
      actionType: 'manual',
      category: 'execution',
    });
  } catch { /* skip */ }

  return permissions;
}

// ── Linux checks ──

async function getLinuxPermissions(): Promise<PermissionCheck[]> {
  const permissions: PermissionCheck[] = [];
  const home = os.homedir();
  const user = os.userInfo().username;

  // Check common directories
  const dirs = [
    { name: '/tmp', label: 'Temp Directory' },
    { name: home, label: 'Home Directory' },
    { name: '/var', label: '/var Directory' },
    { name: '/opt', label: '/opt Directory' },
  ];

  for (const dir of dirs) {
    let readable = false;
    let writable = false;
    try {
      await fs.promises.access(dir.name, fs.constants.R_OK);
      readable = true;
      await fs.promises.access(dir.name, fs.constants.W_OK);
      writable = true;
    } catch { /* not accessible */ }

    permissions.push({
      id: `linux_access_${dir.name.replace(/\//g, '_')}`,
      label: `${dir.label} Access`,
      description: `Read/write access to ${dir.name}`,
      granted: readable && writable,
      instructions: writable
        ? `Full access to ${dir.name}.`
        : `Run: sudo chmod -R u+rw ${dir.name} or add ${user} to the appropriate group.`,
      actionType: writable ? 'manual' : 'run_command',
      actionValue: writable ? undefined : `sudo chown -R ${user} ${dir.name}`,
      category: 'filesystem',
    });
  }

  // Check sudo access
  let hasSudo = false;
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', 'true'], { timeout: 3000 });
    hasSudo = true;
  } catch {
    // sudo requires password — check if user is in sudo group
    try {
      const { stdout } = await execFileAsync('groups', [user], { timeout: 3000 });
      hasSudo = stdout.includes('sudo') || stdout.includes('wheel') || stdout.includes('admin');
    } catch { /* not in sudo group */ }
  }

  permissions.push({
    id: 'linux_sudo',
    label: 'Sudo Access',
    description: 'Ability to run commands as root for system-level operations.',
    granted: hasSudo,
    instructions: hasSudo
      ? 'User has sudo access.'
      : `Add ${user} to the sudo group: sudo usermod -aG sudo ${user}`,
    actionType: 'run_command',
    actionValue: `sudo usermod -aG sudo ${user}`,
    category: 'execution',
  });

  return permissions;
}

// ── Windows checks ──

async function getWindowsPermissions(): Promise<PermissionCheck[]> {
  const permissions: PermissionCheck[] = [];

  // Check if running as admin
  let isAdmin = false;
  try {
    const { stdout } = await execFileAsync('net', ['session'], { timeout: 5000 });
    isAdmin = true;
  } catch {
    isAdmin = false;
  }

  permissions.push({
    id: 'win_admin',
    label: 'Administrator Access',
    description: 'Running with elevated privileges for full system access.',
    granted: isAdmin,
    instructions: isAdmin
      ? 'Running as Administrator.'
      : 'Right-click the application and select "Run as administrator", or open an elevated command prompt.',
    actionType: 'manual',
    category: 'execution',
  });

  // Check developer mode
  let devMode = false;
  try {
    const { stdout } = await execFileAsync('reg', [
      'query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock',
      '/v', 'AllowDevelopmentWithoutDevLicense',
    ], { timeout: 5000 });
    devMode = stdout.includes('0x1');
  } catch {
    devMode = false;
  }

  permissions.push({
    id: 'win_dev_mode',
    label: 'Developer Mode',
    description: 'Enables sideloading apps and advanced development features.',
    granted: devMode,
    instructions: devMode
      ? 'Developer Mode is enabled.'
      : 'Open Settings > Update & Security > For Developers and enable Developer Mode.',
    actionType: 'open_settings',
    actionValue: 'ms-settings:developers',
    category: 'execution',
  });

  // Check common directory access
  const home = os.homedir();
  const dirs = [
    { name: home, label: 'Home Directory' },
    { name: path.join(home, 'Desktop'), label: 'Desktop' },
    { name: path.join(home, 'Documents'), label: 'Documents' },
  ];

  for (const dir of dirs) {
    let writable = false;
    try {
      await fs.promises.access(dir.name, fs.constants.W_OK);
      writable = true;
    } catch { /* not accessible */ }

    permissions.push({
      id: `win_access_${dir.label.toLowerCase()}`,
      label: `${dir.label} Access`,
      description: `Read/write access to ${dir.name}`,
      granted: writable,
      instructions: writable ? `Full access to ${dir.label}.` : `Check folder permissions in Properties > Security tab.`,
      actionType: 'manual',
      category: 'filesystem',
    });
  }

  return permissions;
}

// ── Cross-platform agent permission checks ──

async function getAgentPermissions(): Promise<PermissionCheck[]> {
  const permissions: PermissionCheck[] = [];

  // Check Claude Code config for permissions settings
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let claudeSkipPerms = false;
  try {
    const content = await fs.promises.readFile(claudeSettingsPath, 'utf-8');
    const settings = JSON.parse(content);
    // Claude Code stores allowed tools/permissions in settings
    claudeSkipPerms = Array.isArray(settings.permissions?.allow) && settings.permissions.allow.length > 0;
  } catch { /* no config or parse error */ }

  permissions.push({
    id: 'claude_code_permissions',
    label: 'Claude Code Permissions',
    description: 'Claude Code\'s built-in permission system controls what actions the agent can take (file edits, shell commands, etc.).',
    granted: claudeSkipPerms,
    instructions: claudeSkipPerms
      ? 'Claude Code has custom permissions configured in ~/.claude/settings.json.'
      : 'Run "claude config" to configure permissions, or use the --dangerously-skip-permissions flag (used automatically by Claw Dev).',
    actionType: 'manual',
    category: 'agent',
  });

  // Check if ~/.claude directory exists and is writable
  const claudeDir = path.join(os.homedir(), '.claude');
  let claudeDirOk = false;
  try {
    await fs.promises.access(claudeDir, fs.constants.R_OK | fs.constants.W_OK);
    claudeDirOk = true;
  } catch { /* not accessible */ }

  permissions.push({
    id: 'claude_config_dir',
    label: 'Claude Config Directory',
    description: 'The ~/.claude directory stores Claude Code configuration, sessions, and credentials.',
    granted: claudeDirOk,
    instructions: claudeDirOk
      ? '~/.claude directory is accessible.'
      : 'Run "claude" once to initialize the config directory, or create it: mkdir -p ~/.claude',
    actionType: claudeDirOk ? 'manual' : 'run_command',
    actionValue: claudeDirOk ? undefined : 'mkdir -p ~/.claude',
    category: 'agent',
  });

  // Check if git is configured (needed for many agent operations)
  let gitConfigured = false;
  try {
    const { stdout } = await execFileAsync('git', ['config', 'user.name'], { timeout: 3000 });
    gitConfigured = stdout.trim().length > 0;
  } catch { /* git not configured */ }

  permissions.push({
    id: 'git_identity',
    label: 'Git Identity',
    description: 'Git user name/email — required for agents to make commits.',
    granted: gitConfigured,
    instructions: gitConfigured
      ? 'Git identity is configured.'
      : 'Run: git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
    actionType: gitConfigured ? 'manual' : 'run_command',
    actionValue: gitConfigured ? undefined : 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
    category: 'agent',
  });

  return permissions;
}

// ── Public API ──

async function detectPermissions(): Promise<PermissionsReport> {
  const platform = process.platform;
  let platformPerms: PermissionCheck[] = [];

  if (platform === 'darwin') {
    platformPerms = await getMacosPermissions();
  } else if (platform === 'win32') {
    platformPerms = await getWindowsPermissions();
  } else {
    platformPerms = await getLinuxPermissions();
  }

  const agentPerms = await getAgentPermissions();

  return {
    platform,
    permissions: [...platformPerms, ...agentPerms],
  };
}

async function openSettings(settingsUrl: string): Promise<boolean> {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    await execFileAsync(cmd, [settingsUrl], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], { timeout: 30000 });
    return { success: true, output: stdout + stderr };
  } catch (err: any) {
    return { success: false, output: err.message || 'Command failed' };
  }
}

export default {
  detectPermissions,
  openSettings,
  runCommand,
};
