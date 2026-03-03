import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import config from '../config.ts';
import tunnelManager from './tunnelManager.ts';

interface Credential {
  provider: 'anthropic' | 'github';
  token: string;
  metadata: Record<string, any> | null;
}

interface CredentialStatus {
  connected: boolean;
  metadata?: Record<string, any>;
}

function isActive(): boolean {
  return config.isVps;
}

function getEnvPath(): string {
  return path.join(process.cwd(), '.env');
}

async function syncCredentials(): Promise<void> {
  if (!isActive()) {
    console.log('[credentials] Sync skipped: not in VPS mode');
    return;
  }

  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    console.log('[credentials] Cannot sync: no tunnel credentials or service URL');
    return;
  }

  try {
    const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/sync`, {
      headers: {
        'Authorization': `users API-Key ${creds.apiKey}`,
      },
    });

    if (!res.ok) {
      console.error(`[credentials] Failed to fetch credentials: ${res.status} ${res.statusText}`);
      return;
    }

    const data = await res.json() as { credentials: Credential[] };
    const credentials = data.credentials || [];

    await applyCredentials(credentials);
    console.log(`[credentials] Synced ${credentials.length} credential(s)`);
  } catch (err) {
    console.error('[credentials] Error syncing credentials:', err);
  }
}

async function applyCredentials(credentials: Credential[]): Promise<void> {
  const envPath = getEnvPath();
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  for (const cred of credentials) {
    if (cred.provider === 'anthropic') {
      envContent = setEnvVar(envContent, 'ANTHROPIC_API_KEY', cred.token);
      process.env.ANTHROPIC_API_KEY = cred.token;
    } else if (cred.provider === 'github') {
      envContent = setEnvVar(envContent, 'GITHUB_TOKEN', cred.token);
      process.env.GITHUB_TOKEN = cred.token;

      // Authenticate gh CLI
      try {
        execSync(`echo "${cred.token}" | gh auth login --with-token`, {
          stdio: 'pipe',
          timeout: 10000,
        });
        console.log('[credentials] GitHub CLI authenticated');
      } catch (err) {
        console.error('[credentials] Failed to authenticate gh CLI:', err);
      }
    }
  }

  // Remove env vars for credentials that are no longer present
  const providers = credentials.map(c => c.provider);
  if (!providers.includes('anthropic')) {
    envContent = removeEnvVar(envContent, 'ANTHROPIC_API_KEY');
    delete process.env.ANTHROPIC_API_KEY;
  }
  if (!providers.includes('github')) {
    envContent = removeEnvVar(envContent, 'GITHUB_TOKEN');
    delete process.env.GITHUB_TOKEN;

    // Logout gh CLI
    try {
      execSync('gh auth logout --hostname github.com', {
        stdio: 'pipe',
        input: 'Y\n',
        timeout: 10000,
      });
    } catch {
      // Ignore — may not be logged in
    }
  }

  fs.writeFileSync(envPath, envContent);

  // Also write to system-wide and user shell profile so SSH sessions get the vars
  if (config.isVps) {
    updateSystemEnv(credentials);
  }
}

// Write env vars to /etc/environment (system-wide) and ~/.bashrc (user shell)
function updateSystemEnv(credentials: Credential[]): void {
  const providers = credentials.map(c => c.provider);
  const envVars: Record<string, string | null> = {
    ANTHROPIC_API_KEY: null,
    GITHUB_TOKEN: null,
  };

  for (const cred of credentials) {
    if (cred.provider === 'anthropic') {
      envVars.ANTHROPIC_API_KEY = cred.token;
    } else if (cred.provider === 'github') {
      envVars.GITHUB_TOKEN = cred.token;
    }
  }

  // Update /etc/environment (system-wide for all login sessions)
  const etcEnvPath = '/etc/environment';
  try {
    let content = fs.existsSync(etcEnvPath) ? fs.readFileSync(etcEnvPath, 'utf-8') : '';
    for (const [key, value] of Object.entries(envVars)) {
      if (value) {
        content = setEnvVar(content, key, value);
      } else {
        content = removeEnvVar(content, key);
      }
    }
    fs.writeFileSync(etcEnvPath, content);
  } catch (err) {
    console.error('[credentials] Failed to write /etc/environment:', err);
  }

  // Update ~/.bashrc with export lines (for interactive SSH shells)
  const bashrcPath = path.join(os.homedir(), '.bashrc');
  try {
    let content = fs.existsSync(bashrcPath) ? fs.readFileSync(bashrcPath, 'utf-8') : '';
    for (const [key, value] of Object.entries(envVars)) {
      const exportRegex = new RegExp(`^export ${key}=.*$`, 'm');
      const exportLine = `export ${key}=${value}`;
      if (value) {
        if (exportRegex.test(content)) {
          content = content.replace(exportRegex, exportLine);
        } else {
          content = content.trimEnd() + `\n${exportLine}\n`;
        }
      } else {
        content = content.replace(new RegExp(`^export ${key}=.*\n?`, 'm'), '');
      }
    }
    fs.writeFileSync(bashrcPath, content);
  } catch (err) {
    console.error('[credentials] Failed to write ~/.bashrc:', err);
  }
}

function setEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;

  if (regex.test(content)) {
    return content.replace(regex, line);
  }

  // Append with newline
  const trimmed = content.trimEnd();
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
}

function removeEnvVar(content: string, key: string): string {
  const regex = new RegExp(`^${key}=.*\n?`, 'm');
  return content.replace(regex, '');
}

async function getStatus(provider: 'anthropic' | 'github'): Promise<CredentialStatus> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    return { connected: false };
  }

  try {
    const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/${provider}/status`, {
      headers: {
        'Authorization': `users API-Key ${creds.apiKey}`,
      },
    });

    if (!res.ok) {
      return { connected: false };
    }

    return await res.json() as CredentialStatus;
  } catch {
    return { connected: false };
  }
}

async function setToken(provider: 'anthropic' | 'github', token: string): Promise<CredentialStatus> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  const body = provider === 'anthropic' ? { apiKey: token } : { token };

  const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/${provider}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  const result = await res.json() as CredentialStatus;

  // Sync on VPS after saving
  if (isActive()) {
    await syncCredentials();
  }

  return result;
}

async function disconnectProvider(provider: 'anthropic' | 'github'): Promise<void> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/${provider}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  // Sync on VPS after removing
  if (isActive()) {
    await syncCredentials();
  }
}

export default {
  isActive,
  syncCredentials,
  getStatus,
  setToken,
  disconnectProvider,
};
