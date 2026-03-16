const envMatch = window.location.pathname.match(/^\/(local|vps)/);
const BASE_URL = envMatch ? envMatch[0] : '';

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };

  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, opts);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    // Workspace offline — force full page reload so tunnel proxy serves the offline page
    if (res.status === 503 && error.error === 'workspace_offline') {
      window.location.reload();
      // Never resolves — page is reloading
      return new Promise<T>(() => {});
    }
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export default {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T = any>(path: string) => request<T>('DELETE', path),
};
