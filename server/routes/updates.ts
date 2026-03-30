import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// NOTE: These endpoints do NOT require authentication.
// They are called by client apps (desktop, iOS, Android) before the user has
// logged in, to determine whether an update is available or required.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface VersionsFile {
  desktop: {
    version: string;
    releaseNotes: string;
    releasedAt: string;
    downloads: {
      macos_arm64: string;
      macos_x64: string;
      windows_x64: string;
    };
  };
  ios: {
    version: string;
    minimumVersion: string;
    releaseNotes: string;
    releasedAt: string;
    storeUrl: string;
  };
  android: {
    version: string;
    minimumVersion: string;
    releaseNotes: string;
    releasedAt: string;
    storeUrl: string;
  };
  ota: {
    version: string;
    bundleUrl: string;
    hash: string;
  };
}

/** Path to the versions.json file at the root of claude-dashboard. */
const versionsPath = path.resolve(__dirname, '..', '..', 'versions.json');

/**
 * Read and parse versions.json.  The file is read fresh on every request so
 * that edits take effect without a server restart.
 */
function readVersions(): VersionsFile {
  const raw = fs.readFileSync(versionsPath, 'utf-8');
  return JSON.parse(raw) as VersionsFile;
}

/**
 * Simple semver comparison (major.minor.patch).
 * Returns  -1 if a < b,  0 if a === b,  1 if a > b.
 * Only handles numeric x.y.z versions — pre-release tags are ignored.
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };

  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// GET /updates/manifest — full update manifest for all platforms
// ---------------------------------------------------------------------------

router.get('/updates/manifest', (req: Request, res: Response) => {
  try {
    const v = readVersions();

    const clientIosVersion = (req.query.v as string) || v.ios.version;
    const clientAndroidVersion = (req.query.v as string) || v.android.version;

    res.json({
      desktop: {
        currentVersion: v.desktop.version,
        releaseNotes: v.desktop.releaseNotes,
        releasedAt: v.desktop.releasedAt,
        downloadUrl: {
          macos_arm64: v.desktop.downloads.macos_arm64,
          macos_x64: v.desktop.downloads.macos_x64,
          windows_x64: v.desktop.downloads.windows_x64,
        },
      },
      ios: {
        currentVersion: v.ios.version,
        minimumVersion: v.ios.minimumVersion,
        releaseNotes: v.ios.releaseNotes,
        releasedAt: v.ios.releasedAt,
        storeUrl: v.ios.storeUrl,
        updateAvailable: compareSemver(clientIosVersion, v.ios.version) < 0,
      },
      android: {
        currentVersion: v.android.version,
        minimumVersion: v.android.minimumVersion,
        releaseNotes: v.android.releaseNotes,
        releasedAt: v.android.releasedAt,
        storeUrl: v.android.storeUrl,
        updateAvailable: compareSemver(clientAndroidVersion, v.android.version) < 0,
      },
      ota: {
        version: v.ota.version,
        bundleUrl: v.ota.bundleUrl,
        hash: v.ota.hash,
      },
    });
  } catch (err: any) {
    console.error('Error reading update manifest:', err);
    res.status(500).json({ error: err.message || 'Failed to read update manifest' });
  }
});

// ---------------------------------------------------------------------------
// GET /updates/check/:platform — quick update check for a single platform
// ---------------------------------------------------------------------------

router.get('/updates/check/:platform', (req: Request<{ platform: string }>, res: Response) => {
  try {
    const { platform } = req.params;

    if (platform !== 'desktop' && platform !== 'ios' && platform !== 'android') {
      return res.status(400).json({ error: 'Invalid platform. Must be desktop, ios, or android.' });
    }

    const v = readVersions();
    const clientVersion = req.query.v as string | undefined;

    if (platform === 'desktop') {
      const latestVersion = v.desktop.version;
      const updateAvailable = clientVersion
        ? compareSemver(clientVersion, latestVersion) < 0
        : false;

      return res.json({
        updateAvailable,
        latestVersion,
        minimumVersion: null,
        forceUpdate: false,
        releaseNotes: v.desktop.releaseNotes,
      });
    }

    // ios or android
    const platformInfo = v[platform];
    const latestVersion = platformInfo.version;
    const minimumVersion = platformInfo.minimumVersion;

    const updateAvailable = clientVersion
      ? compareSemver(clientVersion, latestVersion) < 0
      : false;

    const forceUpdate = clientVersion
      ? compareSemver(clientVersion, minimumVersion) < 0
      : false;

    res.json({
      updateAvailable,
      latestVersion,
      minimumVersion,
      forceUpdate,
      releaseNotes: platformInfo.releaseNotes,
      storeUrl: platformInfo.storeUrl,
    });
  } catch (err: any) {
    console.error('Error checking update for platform:', err);
    res.status(500).json({ error: err.message || 'Failed to check for updates' });
  }
});

// ---------------------------------------------------------------------------
// POST /updates/ota — @capgo/capacitor-updater compatible endpoint
// ---------------------------------------------------------------------------
// The capacitor-updater plugin POSTs { platform, device_id, version_name,
// version_build, ... } and expects back either an update object or an empty
// response (204) when no update is available.

router.post('/updates/ota', (req: Request, res: Response) => {
  try {
    const v = readVersions();
    const clientVersion = req.body.version_name as string | undefined;

    // If no OTA bundle is configured yet, signal no update
    if (!v.ota.bundleUrl || !v.ota.version) {
      return res.sendStatus(204);
    }

    // If client already has the latest OTA version, no update
    if (clientVersion && compareSemver(clientVersion, v.ota.version) >= 0) {
      return res.sendStatus(204);
    }

    // Return the update payload in @capgo/capacitor-updater format
    res.json({
      version: v.ota.version,
      url: v.ota.bundleUrl,
      checksum: v.ota.hash,
    });
  } catch (err: any) {
    console.error('Error checking OTA update:', err);
    res.status(500).json({ error: err.message || 'Failed to check OTA update' });
  }
});

export default router;
