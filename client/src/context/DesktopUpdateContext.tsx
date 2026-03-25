import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { isTauriDesktop } from '../utils/platform.ts';

interface DesktopUpdateContextValue {
  updateAvailable: boolean;
  updateVersion: string | null;
  updateBody: string | null;
  checking: boolean;
  downloading: boolean;
  downloadProgress: number;
  error: string | null;
  installed: boolean;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
  dismissError: () => void;
}

const DesktopUpdateContext = createContext<DesktopUpdateContextValue | null>(null);

// Hide module specifiers from Rollup's static analysis so the web build
// doesn't fail when Tauri plugins aren't installed.
const UPDATER_MODULE = '@tauri-apps/' + 'plugin-updater';
const PROCESS_MODULE = '@tauri-apps/' + 'plugin-process';
const EVENT_MODULE = '@tauri-apps/' + 'api/event';

export function DesktopUpdateProvider({ children }: { children: ReactNode }) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateBody, setUpdateBody] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  // Listen for Rust-side auto-check events
  useEffect(() => {
    if (!isTauriDesktop()) return;

    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const { listen } = await import(/* @vite-ignore */ EVENT_MODULE);
        unlisten = await listen('update-available', (event: any) => {
          setUpdateAvailable(true);
          setUpdateVersion(event.payload?.version || null);
          setUpdateBody(event.payload?.body || null);
        });
      } catch {
        // Not in Tauri environment
      }
    })();

    return () => { unlisten?.(); };
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriDesktop()) return;
    setChecking(true);
    setError(null);
    try {
      const { check } = await import(/* @vite-ignore */ UPDATER_MODULE);
      const update = await check();
      if (update) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version);
        setUpdateBody(update.body || null);
      } else {
        setUpdateAvailable(false);
        setUpdateVersion(null);
        setUpdateBody(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to check for updates');
    } finally {
      setChecking(false);
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauriDesktop()) return;
    setDownloading(true);
    setDownloadProgress(0);
    setError(null);
    try {
      const { check } = await import(/* @vite-ignore */ UPDATER_MODULE);
      const update = await check();
      if (!update) {
        setError('No update available');
        setDownloading(false);
        return;
      }

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data?.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data?.chunkLength || 0;
            if (contentLength > 0) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            setDownloadProgress(100);
            break;
        }
      });

      setInstalled(true);
      setUpdateAvailable(false);
    } catch (err: any) {
      setError(err.message || 'Failed to download and install update');
    } finally {
      setDownloading(false);
    }
  }, []);

  const relaunchApp = useCallback(async () => {
    if (!isTauriDesktop()) return;
    try {
      const { relaunch } = await import(/* @vite-ignore */ PROCESS_MODULE);
      await relaunch();
    } catch (err: any) {
      setError(err.message || 'Failed to relaunch. Please restart the app manually.');
    }
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return (
    <DesktopUpdateContext.Provider value={{
      updateAvailable,
      updateVersion,
      updateBody,
      checking,
      downloading,
      downloadProgress,
      error,
      installed,
      checkForUpdate,
      downloadAndInstall,
      relaunch: relaunchApp,
      dismissError,
    }}>
      {children}
    </DesktopUpdateContext.Provider>
  );
}

export function useDesktopUpdate(): DesktopUpdateContextValue {
  const ctx = useContext(DesktopUpdateContext);
  if (!ctx) throw new Error('useDesktopUpdate must be used within DesktopUpdateProvider');
  return ctx;
}
