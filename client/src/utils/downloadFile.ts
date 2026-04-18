import { toast } from 'sonner';
import { isCapacitorNative } from './platform.ts';
import { getPlugin } from './capacitorBridge.ts';

function getApiBase(): string {
  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  return envMatch ? envMatch[0] : '';
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || 'download';
}

export function buildDownloadUrl(projectId: string, filePath: string): string {
  return `${getApiBase()}/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string'));
        return;
      }
      // result is "data:<mime>;base64,<payload>" — strip the prefix
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Download a project file.
 *
 * Native (Capacitor): fetch the bytes, write to the app cache directory via
 * @capacitor/filesystem, then invoke @capacitor/share — this path bypasses the
 * Web Share API entirely, so it has no user-activation or size limits.
 *
 * Web fallback: <a download>.
 */
export async function downloadProjectFile(projectId: string, filePath: string): Promise<void> {
  const url = buildDownloadUrl(projectId, filePath);
  const name = basename(filePath);
  const native = isCapacitorNative();

  if (native) {
    const Filesystem = getPlugin('Filesystem');
    const Share = getPlugin('Share');
    const toastId = `download-${filePath}`;

    if (!Filesystem || !Share) {
      // Plugin missing → the mobile app hasn't been rebuilt with the new
      // plugins yet. Surface this clearly instead of silently failing.
      toast.error('Download plugins not available. Reinstall the mobile app from the latest build.');
      return;
    }

    toast.loading(`Preparing ${name}…`, { id: toastId });

    let base64: string;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      base64 = await blobToBase64(blob);
    } catch (err: any) {
      toast.error(`Download failed: ${err?.message || 'network error'}`, { id: toastId });
      return;
    }

    // Sanitise the filename for the cache path (strip path separators, keep extension).
    const safeName = name.replace(/[/\\]/g, '_');
    const cachePath = `downloads/${Date.now()}-${safeName}`;

    let fileUri: string;
    try {
      const result = await Filesystem.writeFile({
        path: cachePath,
        data: base64,
        directory: 'CACHE',
        recursive: true,
      });
      fileUri = result.uri;
    } catch (err: any) {
      toast.error(`Couldn't save file: ${err?.message || 'filesystem error'}`, { id: toastId });
      return;
    }

    toast.dismiss(toastId);

    try {
      await Share.share({
        title: name,
        files: [fileUri],
        dialogTitle: name,
      });
    } catch (err: any) {
      // Capacitor Share throws with "canceled" / "Share canceled" when the user
      // dismisses the sheet — that's not an error.
      const msg = String(err?.message || err || '').toLowerCase();
      if (msg.includes('cancel')) return;
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
