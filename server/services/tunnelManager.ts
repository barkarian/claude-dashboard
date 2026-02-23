import ngrok from '@ngrok/ngrok';
import config from '../config.ts';
import * as tunnelClient from './tunnelClient.ts';

// --- ngrok types ---
interface NgrokTunnelEntry {
  url: string;
  listener: ngrok.Listener;
  processKey: string;
}

// --- tunnel-service types ---
interface TunnelServiceEntry {
  url: string;
  endpointId: string;
  processKey: string;
}

// --- ngrok state ---
const ngrokTunnels = new Map<number, NgrokTunnelEntry>();
let dashboardListener: ngrok.Listener | null = null;
let dashboardUrl: string | null = null;

// --- tunnel-service state ---
const serviceTunnels = new Map<number, TunnelServiceEntry>();
let tunnelServiceApiKey: string | null = null;
let tunnelServiceSubdomain: string | null = null;

function isEnabled(): boolean {
  return config.tunnelMode === 'ngrok' || config.tunnelMode === 'tunnel-service';
}

function setCredentials(apiKey: string, userSubdomain: string): void {
  // Skip if same credentials are already active (avoids reconnect race)
  if (tunnelServiceApiKey === apiKey && tunnelServiceSubdomain === userSubdomain && tunnelClient.isConnected()) {
    return;
  }
  tunnelServiceApiKey = apiKey;
  tunnelServiceSubdomain = userSubdomain;
  console.log(`[tunnel] Tunnel service credentials set for subdomain: ${userSubdomain}`);

  // Connect WebSocket tunnel client
  if (config.tunnelServiceUrl) {
    const wsUrl = config.tunnelServiceUrl.replace(/^http/, 'ws') + '/tunnel/ws';
    tunnelClient.connect(wsUrl, apiKey, userSubdomain);
  }

  // Auto-register the dashboard itself as a tunnel endpoint
  // so it's accessible at <subdomain>.<TUNNEL_DOMAIN>
  ensureServiceTunnel(config.port, 'dashboard:dashboard').then((url) => {
    if (url) {
      console.log(`[tunnel] Dashboard accessible at ${url}`);
    }
  });
}

function clearCredentials(): void {
  tunnelServiceApiKey = null;
  tunnelServiceSubdomain = null;
  tunnelClient.disconnect();
  console.log('[tunnel] Tunnel service credentials cleared');
}

function getCredentials(): { apiKey: string; userSubdomain: string } | null {
  if (tunnelServiceApiKey && tunnelServiceSubdomain) {
    return { apiKey: tunnelServiceApiKey, userSubdomain: tunnelServiceSubdomain };
  }
  return null;
}

// --- ngrok implementation ---

async function ensureNgrokTunnel(port: number, processKey: string): Promise<string | null> {
  const existing = ngrokTunnels.get(port);
  if (existing) return existing.url;

  try {
    const listener = await ngrok.forward({
      addr: port,
      authtoken_from_env: true,
    });
    const url = listener.url();
    if (!url) return null;

    ngrokTunnels.set(port, { url, listener, processKey });
    console.log(`[tunnel:ngrok] Port ${port} -> ${url} (process: ${processKey})`);
    return url;
  } catch (err) {
    console.error(`[tunnel:ngrok] Failed to create tunnel for port ${port}:`, err);
    return null;
  }
}

async function closeNgrokTunnelsForProcess(processKey: string): Promise<void> {
  const portsToClose: number[] = [];
  for (const [port, entry] of ngrokTunnels) {
    if (entry.processKey === processKey) {
      portsToClose.push(port);
    }
  }

  for (const port of portsToClose) {
    const entry = ngrokTunnels.get(port);
    if (entry) {
      try {
        await entry.listener.close();
        console.log(`[tunnel:ngrok] Closed tunnel for port ${port} (process: ${processKey})`);
      } catch (err) {
        console.error(`[tunnel:ngrok] Error closing tunnel for port ${port}:`, err);
      }
      ngrokTunnels.delete(port);
    }
  }
}

// --- tunnel-service implementation ---

async function ensureServiceTunnel(port: number, processKey: string): Promise<string | null> {
  if (!tunnelServiceApiKey || !config.tunnelServiceUrl) return null;

  const existing = serviceTunnels.get(port);
  if (existing) return existing.url;

  // Extract projectUUID from processKey (format: "projectId:scriptId")
  const projectUUID = processKey.split(':')[0];

  try {
    const res = await fetch(`${config.tunnelServiceUrl}/api/tunnel-endpoints/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `users API-Key ${tunnelServiceApiKey}`,
      },
      body: JSON.stringify({ projectUUID, port }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error(`[tunnel:service] Failed to register endpoint:`, (err as any).error);
      return null;
    }

    const data = await res.json() as { id: string; publicUrl: string };

    serviceTunnels.set(port, {
      url: data.publicUrl,
      endpointId: data.id,
      processKey,
    });

    console.log(`[tunnel:service] Port ${port} -> ${data.publicUrl} (process: ${processKey})`);
    return data.publicUrl;
  } catch (err) {
    console.error(`[tunnel:service] Failed to create tunnel for port ${port}:`, err);
    return null;
  }
}

async function closeServiceTunnelsForProcess(processKey: string): Promise<void> {
  if (!tunnelServiceApiKey || !config.tunnelServiceUrl) return;

  const portsToClose: number[] = [];
  for (const [port, entry] of serviceTunnels) {
    if (entry.processKey === processKey) {
      portsToClose.push(port);
    }
  }

  for (const port of portsToClose) {
    const entry = serviceTunnels.get(port);
    if (entry) {
      try {
        await fetch(`${config.tunnelServiceUrl}/api/tunnel-endpoints/${entry.endpointId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `users API-Key ${tunnelServiceApiKey}`,
          },
        });
        console.log(`[tunnel:service] Deactivated endpoint for port ${port} (process: ${processKey})`);
      } catch (err) {
        console.error(`[tunnel:service] Error deactivating endpoint for port ${port}:`, err);
      }
      serviceTunnels.delete(port);
    }
  }
}

// --- unified interface ---

async function ensureTunnel(port: number, processKey: string): Promise<string | null> {
  if (!isEnabled()) return null;

  if (config.tunnelMode === 'ngrok') {
    return ensureNgrokTunnel(port, processKey);
  }

  if (config.tunnelMode === 'tunnel-service') {
    return ensureServiceTunnel(port, processKey);
  }

  return null;
}

async function getTunnelUrls(ports: number[], processKey: string): Promise<Record<number, string>> {
  if (!isEnabled() || ports.length === 0) return {};

  const results = await Promise.all(
    ports.map(async (port) => {
      const url = await ensureTunnel(port, processKey);
      return { port, url };
    })
  );

  const urls: Record<number, string> = {};
  for (const { port, url } of results) {
    if (url) urls[port] = url;
  }
  return urls;
}

async function closeTunnelsForProcess(processKey: string): Promise<void> {
  if (!isEnabled()) return;

  if (config.tunnelMode === 'ngrok') {
    return closeNgrokTunnelsForProcess(processKey);
  }

  if (config.tunnelMode === 'tunnel-service') {
    return closeServiceTunnelsForProcess(processKey);
  }
}

async function startDashboardTunnel(port: number): Promise<string | null> {
  // Dashboard tunnel only makes sense for ngrok mode
  if (config.tunnelMode !== 'ngrok') return null;

  try {
    dashboardListener = await ngrok.forward({
      addr: port,
      authtoken_from_env: true,
    });
    dashboardUrl = dashboardListener.url();
    if (dashboardUrl) {
      console.log(`[tunnel] Dashboard -> ${dashboardUrl}`);
    }
    return dashboardUrl;
  } catch (err) {
    console.error('[tunnel] Failed to create dashboard tunnel:', err);
    return null;
  }
}

async function closeAll(): Promise<void> {
  if (!isEnabled()) return;

  // Disconnect WebSocket tunnel client
  tunnelClient.disconnect();

  // Close ngrok tunnels
  for (const [port, entry] of ngrokTunnels) {
    try {
      await entry.listener.close();
      console.log(`[tunnel:ngrok] Closed tunnel for port ${port}`);
    } catch (err) {
      console.error(`[tunnel:ngrok] Error closing tunnel for port ${port}:`, err);
    }
  }
  ngrokTunnels.clear();

  if (dashboardListener) {
    try {
      await dashboardListener.close();
      console.log('[tunnel:ngrok] Closed dashboard tunnel');
    } catch (err) {
      console.error('[tunnel:ngrok] Error closing dashboard tunnel:', err);
    }
    dashboardListener = null;
    dashboardUrl = null;
  }

  // Deactivate all tunnel-service endpoints
  if (tunnelServiceApiKey && config.tunnelServiceUrl) {
    for (const [port, entry] of serviceTunnels) {
      try {
        await fetch(`${config.tunnelServiceUrl}/api/tunnel-endpoints/${entry.endpointId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `users API-Key ${tunnelServiceApiKey}`,
          },
        });
        console.log(`[tunnel:service] Deactivated endpoint for port ${port}`);
      } catch (err) {
        console.error(`[tunnel:service] Error deactivating endpoint for port ${port}:`, err);
      }
    }
  }
  serviceTunnels.clear();
}

async function waitForConnection(timeoutMs = 10_000): Promise<boolean> {
  return tunnelClient.waitForConnection(timeoutMs);
}

export default {
  isEnabled,
  ensureTunnel,
  getTunnelUrls,
  closeTunnelsForProcess,
  startDashboardTunnel,
  closeAll,
  setCredentials,
  clearCredentials,
  getCredentials,
  waitForConnection,
};
