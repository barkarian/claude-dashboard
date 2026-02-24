import fs from 'fs';
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
  connected?: boolean;
  configured?: boolean;
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

async function setAnthropicKey(apiKey: string): Promise<CredentialStatus> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/anthropic`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
    body: JSON.stringify({ apiKey }),
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

async function getGitHubConnectUrl(redirectUri: string): Promise<string> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  // Create a short-lived auth_code via authorization-codes collection
  const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/github/connect-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
    body: JSON.stringify({ redirectUri }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  const data = await res.json() as { url: string };
  return data.url;
}

async function setGitHubApp(clientId: string, clientSecret: string): Promise<CredentialStatus> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  const res = await fetch(`${config.tunnelServiceUrl}/api/credentials/github/app`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  return await res.json() as CredentialStatus;
}

export default {
  isActive,
  syncCredentials,
  getStatus,
  setAnthropicKey,
  setGitHubApp,
  disconnectProvider,
  getGitHubConnectUrl,
};
