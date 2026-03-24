import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSetting, setSetting } from './database.ts';

const execFileAsync = promisify(execFile);

// ── Sleep Prevention Daemon Constants ──

const DAEMON_LABEL = 'com.claw-dev.sleep-prevention';
const DAEMON_PLIST_PATH = '/Library/LaunchDaemons/com.claw-dev.sleep-prevention.plist';
const HELPER_PATH = '/Library/PrivilegedHelperTools/com.claw-dev.sleep-prevention';
const CONTROL_FILE = '/tmp/com.claw-dev.sleep-active';

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

/** Whether this process is running inside the Claw Dev desktop app */
function isDesktopApp(): boolean {
  return process.env.CLAW_DESKTOP === '1';
}

/** Whether the desktop app is running from a .app bundle (production) vs dev mode */
function isProductionBundle(): boolean {
  // In production, the sidecar runs from inside Claw Dev.app/Contents/Resources/...
  // In dev mode, it runs from the project directory
  return process.cwd().includes('.app/') || process.cwd().includes('.app\\');
}

async function checkMacosFullDiskAccess(): Promise<boolean> {
  // Try multiple TCC-protected paths — any success means FDA is granted
  // for the "responsible process" (the app that spawned this Node process).
  const tccPaths = [
    '/Library/Application Support/com.apple.TCC/TCC.db',
    '/Library/Application Support/com.apple.TCC',
  ];

  for (const p of tccPaths) {
    try {
      // Use readFile/readdir (not just access) — access() can give false positives
      const stat = await fs.promises.stat(p);
      if (stat.isDirectory()) {
        await fs.promises.readdir(p);
      } else {
        // Read first byte to confirm actual read access
        const fd = await fs.promises.open(p, 'r');
        await fd.close();
      }
      return true;
    } catch {
      // This path didn't work, try next
    }
  }
  return false;
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

async function getMacosPermissions(): Promise<PermissionCheck[]> {
  const [fda, desktop, documents, downloads] = await Promise.all([
    checkMacosFullDiskAccess(),
    checkFolderAccess('Desktop'),
    checkFolderAccess('Documents'),
    checkFolderAccess('Downloads'),
  ]);

  // Context-aware instructions based on how the server is running:
  // 1. Production .app bundle → add "Claw Dev" to FDA
  // 2. Desktop dev mode (tauri dev) → add the Tauri dev binary to FDA
  // 3. Terminal mode (no desktop) → add the terminal app to FDA
  //
  // IMPORTANT: macOS TCC grants FDA to the "responsible process" — the app that
  // spawned this Node.js server. Having Terminal with FDA does NOT help if the
  // server was spawned by the Claw Dev / Tauri dev binary.
  const desktop_mode = isDesktopApp();
  const production = isProductionBundle();

  let fdaInstructions: string;
  if (fda) {
    fdaInstructions = 'Full Disk Access is granted. To revoke, open System Settings > Privacy & Security > Full Disk Access and toggle off the app.';
  } else if (desktop_mode && production) {
    fdaInstructions = 'Open System Settings > Privacy & Security > Full Disk Access and toggle on "claw-dev-desktop" (the executable icon, not the app icon). macOS grants FDA to the binary that spawns the server, not the .app wrapper. If not listed, click + and navigate to /Applications/Claw Dev.app/Contents/MacOS/claw-dev-desktop.';
  } else if (desktop_mode) {
    // Dev mode (tauri dev) — the binary is target/debug/claw-dev or similar
    fdaInstructions = 'You are running in development mode (tauri dev). The Tauri dev binary needs Full Disk Access, not Terminal. Open System Settings > Privacy & Security > Full Disk Access, click +, then press Cmd+Shift+G and navigate to the target/debug folder in your desktop/src-tauri directory to add the dev binary. Alternatively, run the server directly from Terminal (without Tauri) during development.';
  } else {
    fdaInstructions = 'Open System Settings > Privacy & Security > Full Disk Access, click the + button, and add your terminal app (Terminal, iTerm2, Warp, etc.).';
  }

  const permissions: PermissionCheck[] = [
    {
      id: 'macos_full_disk_access',
      label: 'Full Disk Access',
      description: 'Allows agents to read/write any file on your Mac. Grants access to all directories without individual prompts.',
      granted: fda,
      instructions: fdaInstructions,
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
  ];

  // Check if the sleep prevention LaunchDaemon is installed.
  // The daemon handles pmset disablesleep silently — no admin prompt on each launch.
  const daemonInstalled = isDaemonInstalled();
  permissions.push({
    id: 'macos_sleep_prevention',
    label: 'Sleep Prevention',
    description: 'Prevents Mac from sleeping (including lid close), keeping tunnels and agents active. One-time admin setup.',
    granted: daemonInstalled,
    instructions: daemonInstalled
      ? 'Sleep prevention daemon is installed. The Mac will stay awake even with the lid closed while the app runs. Sleep is automatically re-enabled when the app exits. No admin prompt needed on launch.'
      : 'Install a LaunchDaemon to fully prevent sleep (including lid close). Requires a one-time admin password. Without this, only idle sleep is prevented via caffeinate.',
    actionType: 'manual',
    category: 'execution',
  });

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

// ── Sleep Prevention Daemon Functions ──

/** Check if the LaunchDaemon plist exists on disk */
function isDaemonInstalled(): boolean {
  return fs.existsSync(DAEMON_PLIST_PATH);
}

/** Generate the helper bash script that the LaunchDaemon runs */
function generateHelperScript(): string {
  return `#!/bin/bash
# Sleep prevention helper for Claw Dev
# Polls the control file and manages pmset disablesleep accordingly.

CONTROL_FILE="${CONTROL_FILE}"
ACTIVE=0

cleanup() {
  if [ "$ACTIVE" -eq 1 ]; then
    /usr/bin/pmset disablesleep 0
    echo "$(date): Cleanup — pmset disablesleep 0"
  fi
  # Remove stale control file if it exists
  [ -f "$CONTROL_FILE" ] && rm -f "$CONTROL_FILE"
  exit 0
}

trap cleanup SIGTERM SIGINT

while true; do
  if [ -f "$CONTROL_FILE" ]; then
    PID=$(cat "$CONTROL_FILE" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      # Verify process name contains "claw-dev" to guard against PID reuse
      PROC_NAME=$(ps -p "$PID" -o comm= 2>/dev/null)
      if echo "$PROC_NAME" | grep -q "claw-dev"; then
        if [ "$ACTIVE" -eq 0 ]; then
          /usr/bin/pmset disablesleep 1
          ACTIVE=1
          echo "$(date): Activated pmset disablesleep 1 for PID $PID ($PROC_NAME)"
        fi
      else
        # PID reused by another process — stale control file
        echo "$(date): Stale PID $PID (process: $PROC_NAME), removing control file"
        rm -f "$CONTROL_FILE"
        if [ "$ACTIVE" -eq 1 ]; then
          /usr/bin/pmset disablesleep 0
          ACTIVE=0
          echo "$(date): Deactivated pmset disablesleep 0"
        fi
      fi
    else
      # PID is dead — clean up
      echo "$(date): PID $PID is dead, removing control file"
      rm -f "$CONTROL_FILE"
      if [ "$ACTIVE" -eq 1 ]; then
        /usr/bin/pmset disablesleep 0
        ACTIVE=0
        echo "$(date): Deactivated pmset disablesleep 0"
      fi
    fi
  else
    # No control file — deactivate if active
    if [ "$ACTIVE" -eq 1 ]; then
      /usr/bin/pmset disablesleep 0
      ACTIVE=0
      echo "$(date): Control file removed, deactivated pmset disablesleep 0"
    fi
  fi
  sleep 3
done
`;
}

/** Generate the LaunchDaemon plist XML */
function generatePlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${HELPER_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/com.claw-dev.sleep-prevention.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/com.claw-dev.sleep-prevention.log</string>
</dict>
</plist>
`;
}

/**
 * Install the LaunchDaemon for sleep prevention (macOS only).
 * Shows a single admin password dialog to create the helper script, plist, and bootstrap the daemon.
 */
async function requestSleepPrevention(): Promise<{ success: boolean; output: string }> {
  if (process.platform !== 'darwin') {
    return { success: false, output: 'Only supported on macOS' };
  }

  // If daemon is already installed, just save setting and write control file
  if (isDaemonInstalled()) {
    setSetting('sleep_prevention_opted_in', 'true');
    try {
      fs.writeFileSync(CONTROL_FILE, String(process.pid));
    } catch { /* best effort */ }
    return { success: true, output: 'Daemon already installed, sleep prevention activated' };
  }

  const helperScript = generateHelperScript();
  const plistContent = generatePlist();

  // Use base64 encoding to avoid shell escaping issues with $(), quotes, etc.
  const helperB64 = Buffer.from(helperScript).toString('base64');
  const plistB64 = Buffer.from(plistContent).toString('base64');

  // Single admin prompt that installs everything
  const shellCmd = [
    // Create helper directory if needed
    `mkdir -p /Library/PrivilegedHelperTools`,
    // Write helper script (base64 decode avoids all escaping issues)
    `echo '${helperB64}' | base64 -D > ${HELPER_PATH}`,
    // Set permissions: root:wheel, executable
    `chown root:wheel ${HELPER_PATH}`,
    `chmod 755 ${HELPER_PATH}`,
    // Write plist (base64 decode)
    `echo '${plistB64}' | base64 -D > ${DAEMON_PLIST_PATH}`,
    // Set permissions: root:wheel, read-only
    `chown root:wheel ${DAEMON_PLIST_PATH}`,
    `chmod 644 ${DAEMON_PLIST_PATH}`,
    // Bootstrap the daemon
    `launchctl bootstrap system ${DAEMON_PLIST_PATH}`,
  ].join(' && ');

  const script = `do shell script "${shellCmd}" with administrator privileges`;

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 60000 });
    setSetting('sleep_prevention_opted_in', 'true');
    // Write control file so daemon activates immediately
    try {
      fs.writeFileSync(CONTROL_FILE, String(process.pid));
    } catch { /* best effort */ }
    return { success: true, output: 'Sleep prevention daemon installed and activated' };
  } catch (err: any) {
    const msg = err.stderr || err.message || 'Admin auth denied or failed';
    return { success: false, output: msg };
  }
}

/**
 * Uninstall the LaunchDaemon and disable sleep prevention.
 * Shows admin password dialog to remove the daemon.
 */
async function revokeSleepPrevention(): Promise<{ success: boolean; output: string }> {
  if (process.platform !== 'darwin') {
    return { success: false, output: 'Only supported on macOS' };
  }

  // Delete control file first (no admin needed)
  try {
    fs.unlinkSync(CONTROL_FILE);
  } catch { /* may not exist */ }

  const shellCmd = [
    // Bootout the daemon
    `launchctl bootout system/${DAEMON_LABEL} 2>/dev/null`,
    // Ensure sleep is re-enabled
    `pmset disablesleep 0`,
    // Remove the plist and helper
    `rm -f ${DAEMON_PLIST_PATH}`,
    `rm -f ${HELPER_PATH}`,
  ].join('; ');

  const script = `do shell script "${shellCmd}" with administrator privileges`;

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 60000 });
    setSetting('sleep_prevention_opted_in', 'false');
    return { success: true, output: 'Sleep prevention daemon removed' };
  } catch (err: any) {
    const msg = err.stderr || err.message || 'Admin auth denied or failed';
    return { success: false, output: msg };
  }
}

/**
 * Auto-activate sleep prevention on startup if the user previously opted in.
 * If daemon is installed, just writes the control file (no admin prompt).
 * If daemon was removed externally, clears the stale opt-in setting.
 */
async function autoActivateSleepPrevention(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const optedIn = getSetting('sleep_prevention_opted_in');
  if (optedIn !== 'true') return;

  if (!isDaemonInstalled()) {
    // Daemon was removed externally — clear stale opt-in
    console.log('[startup] Sleep prevention daemon missing, clearing stale opt-in');
    setSetting('sleep_prevention_opted_in', 'false');
    return;
  }

  // Daemon is installed — just write the control file (no admin prompt!)
  try {
    fs.writeFileSync(CONTROL_FILE, String(process.pid));
    console.log('[startup] Wrote PID to control file, daemon will activate pmset disablesleep');
  } catch (err) {
    console.warn('[startup] Failed to write control file:', err);
  }
}

export default {
  detectPermissions,
  openSettings,
  runCommand,
  requestSleepPrevention,
  revokeSleepPrevention,
  autoActivateSleepPrevention,
};
