import { toast } from 'sonner';
import { isCapacitorNative } from './platform.ts';

function getApiBase(): string {
  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  return envMatch ? envMatch[0] : '';
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || 'download';
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
    js: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain',
    html: 'text/html', css: 'text/css', xml: 'application/xml',
    yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain',
    pdf: 'application/pdf', zip: 'application/zip',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

export function buildDownloadUrl(projectId: string, filePath: string): string {
  return `${getApiBase()}/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`;
}

/**
 * Download a project file.
 *
 * Capacitor iOS WKWebView does NOT honour <a download>, and navigating to an
 * application/octet-stream response shows iOS's "Open in..." sheet (with Notes,
 * etc.) — and because the WebView navigates, swiping back afterwards triggers
 * our global swipe-to-open-sidebar handler. So on native we go through the
 * Web Share API only. If that fails we surface a toast instead of falling back
 * to a navigation, so we never trigger the sidebar as a side-effect.
 */
export async function downloadProjectFile(projectId: string, filePath: string): Promise<void> {
  const url = buildDownloadUrl(projectId, filePath);
  const name = basename(filePath);
  const native = isCapacitorNative();
  const toastId = `download-${filePath}`;

  if (native) {
    toast.loading(`Preparing ${name}…`, { id: toastId });

    const canShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function';

    if (!canShareFiles) {
      toast.error('Downloads require iOS 15+ or an updated Android. Use desktop for now.', { id: toastId });
      return;
    }

    let blob: Blob;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      blob = await resp.blob();
    } catch (err: any) {
      toast.error(`Download failed: ${err?.message || 'network error'}`, { id: toastId });
      return;
    }

    const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : guessMime(name);
    const file = new File([blob], name, { type: mime });

    if (!navigator.canShare({ files: [file] })) {
      toast.error('This device does not allow sharing files from the app.', { id: toastId });
      return;
    }

    try {
      toast.dismiss(toastId);
      await navigator.share({ files: [file], title: name });
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled the share sheet
      toast.error(`Share failed: ${err?.message || 'unknown error'}`);
    }
    return;
  }

  // Regular web browser: anchor with download attribute is fine.
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
