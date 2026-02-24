import config from '../config.ts';
import tunnelManager from './tunnelManager.ts';

function getAuthHeaders(): Record<string, string> {
  const creds = tunnelManager.getCredentials();
  if (!creds) {
    throw new Error('No tunnel credentials available');
  }
  return {
    'Authorization': `users API-Key ${creds.apiKey}`,
    'Content-Type': 'application/json',
  };
}

function getBaseUrl(): string {
  if (!config.tunnelServiceUrl) {
    throw new Error('Tunnel service URL not configured');
  }
  return config.tunnelServiceUrl;
}

async function getBillingConfig(): Promise<{ stripeEnabled: boolean }> {
  const res = await fetch(`${getBaseUrl()}/api/billing/config`);
  if (!res.ok) {
    throw new Error(`Failed to fetch billing config: ${res.status}`);
  }
  return await res.json() as { stripeEnabled: boolean };
}

async function createCheckout(successUrl?: string, cancelUrl?: string): Promise<{ url: string; sessionId: string }> {
  const res = await fetch(`${getBaseUrl()}/api/billing/create-checkout`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ successUrl, cancelUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return await res.json() as { url: string; sessionId: string };
}

async function createCustomerPortal(returnUrl?: string): Promise<{ url: string }> {
  const res = await fetch(`${getBaseUrl()}/api/billing/customer-portal`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ returnUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return await res.json() as { url: string };
}

async function devUpgrade(): Promise<{ success: boolean; plan: string }> {
  const res = await fetch(`${getBaseUrl()}/api/billing/dev-upgrade`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return await res.json() as { success: boolean; plan: string };
}

async function devDowngrade(): Promise<{ success: boolean; plan: string }> {
  const res = await fetch(`${getBaseUrl()}/api/billing/dev-downgrade`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return await res.json() as { success: boolean; plan: string };
}

async function getVpsStatus(): Promise<any> {
  const res = await fetch(`${getBaseUrl()}/api/vps/status`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 404) {
    return { vpsInstance: null };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return await res.json();
}

async function destroyVps(): Promise<any> {
  const res = await fetch(`${getBaseUrl()}/api/vps/destroy`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return await res.json();
}

export default {
  getBillingConfig,
  createCheckout,
  createCustomerPortal,
  devUpgrade,
  devDowngrade,
  getVpsStatus,
  destroyVps,
};
