import fs from 'fs';
import path from 'path';
import os from 'os';
import config from '../config.ts';
import tunnelManager from './tunnelManager.ts';

interface SshKey {
  id: string;
  label: string;
  publicKey: string;
  fingerprint: string | null;
  createdAt: string;
}

function isActive(): boolean {
  return config.isVps;
}

function getAuthorizedKeysPath(): string {
  return path.join(os.homedir(), '.ssh', 'authorized_keys');
}

async function fetchSshKeys(): Promise<SshKey[]> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    console.log('[ssh-keys] Cannot fetch keys: no tunnel credentials or service URL');
    return [];
  }

  try {
    const res = await fetch(`${config.tunnelServiceUrl}/api/ssh-keys`, {
      headers: {
        'Authorization': `users API-Key ${creds.apiKey}`,
      },
    });

    if (!res.ok) {
      console.error(`[ssh-keys] Failed to fetch keys: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json() as { keys: SshKey[] };
    return data.keys || [];
  } catch (err) {
    console.error('[ssh-keys] Error fetching keys:', err);
    return [];
  }
}

async function addSshKey(label: string, publicKey: string): Promise<SshKey | null> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  const res = await fetch(`${config.tunnelServiceUrl}/api/ssh-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
    body: JSON.stringify({ label, publicKey }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  const key = await res.json() as SshKey;

  // Sync authorized_keys on VPS after adding
  if (isActive()) {
    await syncAuthorizedKeys();
  }

  return key;
}

async function deleteSshKey(keyId: string): Promise<void> {
  const creds = tunnelManager.getCredentials();
  if (!creds || !config.tunnelServiceUrl) {
    throw new Error('No tunnel credentials or service URL configured');
  }

  const res = await fetch(`${config.tunnelServiceUrl}/api/ssh-keys/${keyId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `users API-Key ${creds.apiKey}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  // Sync authorized_keys on VPS after removing
  if (isActive()) {
    await syncAuthorizedKeys();
  }
}

async function syncAuthorizedKeys(): Promise<void> {
  if (!isActive()) {
    console.log('[ssh-keys] Sync skipped: not in VPS mode');
    return;
  }

  try {
    const keys = await fetchSshKeys();
    await writeAuthorizedKeys(keys);
    console.log(`[ssh-keys] Synced ${keys.length} key(s) to authorized_keys`);
  } catch (err) {
    console.error('[ssh-keys] Failed to sync authorized_keys:', err);
  }
}

async function writeAuthorizedKeys(keys: SshKey[]): Promise<void> {
  const sshDir = path.join(os.homedir(), '.ssh');
  const authorizedKeysPath = getAuthorizedKeysPath();

  // Ensure ~/.ssh directory exists with correct permissions
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
  }

  // Build authorized_keys content
  const managedHeader = '# Managed by Claw Dashboard — do not edit this section manually';
  const managedFooter = '# End of Claw Dashboard managed keys';

  // Read existing file to preserve non-managed keys
  let existingContent = '';
  if (fs.existsSync(authorizedKeysPath)) {
    existingContent = fs.readFileSync(authorizedKeysPath, 'utf-8');
  }

  // Extract non-managed content (anything outside our managed block)
  let preservedLines = '';
  const headerIdx = existingContent.indexOf(managedHeader);
  const footerIdx = existingContent.indexOf(managedFooter);

  if (headerIdx !== -1 && footerIdx !== -1) {
    // Content before managed block
    const before = existingContent.slice(0, headerIdx).trim();
    // Content after managed block
    const after = existingContent.slice(footerIdx + managedFooter.length).trim();
    preservedLines = [before, after].filter(Boolean).join('\n');
  } else {
    // No managed block found — preserve everything
    preservedLines = existingContent.trim();
  }

  // Build managed key block
  const managedKeys = keys
    .map(k => `# ${k.label}\n${k.publicKey.trim()}`)
    .join('\n');

  const managedBlock = [managedHeader, managedKeys, managedFooter].join('\n');

  // Combine preserved + managed
  const finalContent = [preservedLines, managedBlock]
    .filter(Boolean)
    .join('\n\n') + '\n';

  fs.writeFileSync(authorizedKeysPath, finalContent, { mode: 0o600 });
}

export default {
  isActive,
  fetchSshKeys,
  addSshKey,
  deleteSshKey,
  syncAuthorizedKeys,
};
