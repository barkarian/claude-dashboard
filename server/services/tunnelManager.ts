import ngrok from '@ngrok/ngrok';
import config from '../config.ts';

interface TunnelEntry {
  url: string;
  listener: ngrok.Listener;
  processKey: string;
}

// Keyed by port number (globally unique on the machine)
const tunnels = new Map<number, TunnelEntry>();
let dashboardListener: ngrok.Listener | null = null;
let dashboardUrl: string | null = null;

function isEnabled(): boolean {
  return config.tunnelMode === 'ngrok';
}

async function ensureTunnel(port: number, processKey: string): Promise<string | null> {
  if (!isEnabled()) return null;

  const existing = tunnels.get(port);
  if (existing) return existing.url;

  try {
    const listener = await ngrok.forward({
      addr: port,
      authtoken_from_env: true,
    });
    const url = listener.url();
    if (!url) return null;

    tunnels.set(port, { url, listener, processKey });
    console.log(`[tunnel] Port ${port} -> ${url} (process: ${processKey})`);
    return url;
  } catch (err) {
    console.error(`[tunnel] Failed to create tunnel for port ${port}:`, err);
    return null;
  }
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

  const portsToClose: number[] = [];
  for (const [port, entry] of tunnels) {
    if (entry.processKey === processKey) {
      portsToClose.push(port);
    }
  }

  for (const port of portsToClose) {
    const entry = tunnels.get(port);
    if (entry) {
      try {
        await entry.listener.close();
        console.log(`[tunnel] Closed tunnel for port ${port} (process: ${processKey})`);
      } catch (err) {
        console.error(`[tunnel] Error closing tunnel for port ${port}:`, err);
      }
      tunnels.delete(port);
    }
  }
}

async function startDashboardTunnel(port: number): Promise<string | null> {
  if (!isEnabled()) return null;

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

  // Close all process tunnels
  for (const [port, entry] of tunnels) {
    try {
      await entry.listener.close();
      console.log(`[tunnel] Closed tunnel for port ${port}`);
    } catch (err) {
      console.error(`[tunnel] Error closing tunnel for port ${port}:`, err);
    }
  }
  tunnels.clear();

  // Close dashboard tunnel
  if (dashboardListener) {
    try {
      await dashboardListener.close();
      console.log('[tunnel] Closed dashboard tunnel');
    } catch (err) {
      console.error('[tunnel] Error closing dashboard tunnel:', err);
    }
    dashboardListener = null;
    dashboardUrl = null;
  }
}

export default {
  isEnabled,
  ensureTunnel,
  getTunnelUrls,
  closeTunnelsForProcess,
  startDashboardTunnel,
  closeAll,
};
