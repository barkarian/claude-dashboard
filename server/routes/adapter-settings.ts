/**
 * REST API routes for per-adapter settings (enable/disable, API keys, config).
 *
 * Settings are stored locally in the adapter_settings SQLite table.
 */

import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fsAsync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getAllAdapterSettings,
  getAdapterSettings,
  setAdapterSetting,
  deleteAdapterSetting,
  getEnabledAdapterIds,
  hasAnyAdapterSettings,
  isAdapterEnabled,
  getStoredDefaultAdapter,
  setStoredDefaultAdapter,
  resolveDefaultAdapter,
  getDefaultModel,
  setDefaultModel,
  getFavoriteModels,
  setFavoriteModels,
} from '../services/database.ts';
import { adapterRegistry } from '../adapters/registry.ts';

const execFileAsync = promisify(execFile);
const router = Router();

/** Read Claude Code OAuth token from macOS Keychain */
async function readClaudeKeychainToken(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const user = process.env.USER || process.env.LOGNAME || '';
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-a', user, '-w',
    ]);
    const json = JSON.parse(stdout.trim());
    const token = json?.claudeAiOauth?.accessToken;
    return (token && typeof token === 'string') ? token : null;
  } catch {
    return null;
  }
}

/** GET /api/adapter-settings — all adapter settings as { adapterId: { key: value } } */
router.get('/', (_req, res) => {
  res.json(getAllAdapterSettings());
});

/** GET /api/adapter-settings/enabled — list of enabled adapter IDs */
router.get('/enabled', (_req, res) => {
  res.json(getEnabledAdapterIds());
});

/** GET /api/adapter-settings/auto-detect — check if first run */
router.get('/needs-setup', (_req, res) => {
  res.json({ needsSetup: !hasAnyAdapterSettings() });
});

/** GET /api/adapter-settings/default — global default adapter (stored + effective) */
router.get('/default', (_req, res) => {
  res.json({
    stored: getStoredDefaultAdapter(),
    effective: resolveDefaultAdapter(),
  });
});

/** PUT /api/adapter-settings/default — set global default adapter */
router.put('/default', (req, res) => {
  const { defaultAdapter } = req.body as { defaultAdapter?: string };
  if (!defaultAdapter || typeof defaultAdapter !== 'string') {
    res.status(400).json({ error: 'defaultAdapter required' });
    return;
  }
  if (!adapterRegistry.has(defaultAdapter)) {
    res.status(404).json({ error: `Adapter not found: ${defaultAdapter}` });
    return;
  }
  setStoredDefaultAdapter(defaultAdapter);
  res.json({
    stored: getStoredDefaultAdapter(),
    effective: resolveDefaultAdapter(),
  });
});

/** GET /api/adapter-settings/:id/default-model — adapter's default model id */
router.get('/:id/default-model', (req, res) => {
  const { id } = req.params;
  if (!adapterRegistry.has(id)) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }
  res.json({ defaultModel: getDefaultModel(id) });
});

/** PUT /api/adapter-settings/:id/default-model — set/clear adapter's default model */
router.put('/:id/default-model', (req, res) => {
  const { id } = req.params;
  if (!adapterRegistry.has(id)) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }
  const { defaultModel } = req.body as { defaultModel?: string | null };
  if (defaultModel !== null && typeof defaultModel !== 'string') {
    res.status(400).json({ error: 'defaultModel must be a string or null' });
    return;
  }
  setDefaultModel(id, defaultModel ?? null);
  res.json({ defaultModel: getDefaultModel(id) });
});

/** GET /api/adapter-settings/:id/favorite-models — adapter's favorite model ids */
router.get('/:id/favorite-models', (req, res) => {
  const { id } = req.params;
  if (!adapterRegistry.has(id)) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }
  res.json({ favoriteModels: getFavoriteModels(id) });
});

/** PUT /api/adapter-settings/:id/favorite-models — replace adapter's favorites list */
router.put('/:id/favorite-models', (req, res) => {
  const { id } = req.params;
  if (!adapterRegistry.has(id)) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }
  const { favoriteModels } = req.body as { favoriteModels?: unknown };
  if (!Array.isArray(favoriteModels) || !favoriteModels.every((x) => typeof x === 'string')) {
    res.status(400).json({ error: 'favoriteModels must be an array of strings' });
    return;
  }
  setFavoriteModels(id, favoriteModels as string[]);
  res.json({ favoriteModels: getFavoriteModels(id) });
});

/** GET /api/adapter-settings/:id — settings for one adapter */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!adapterRegistry.has(id)) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }
  res.json(getAdapterSettings(id));
});

/** PUT /api/adapter-settings/:id — bulk update settings for one adapter */
router.put('/:id', (req, res) => {
  const { id } = req.params;
  if (!adapterRegistry.has(id)) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }

  const updates = req.body as Record<string, string | null>;
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') {
      deleteAdapterSetting(id, key);
    } else {
      setAdapterSetting(id, key, String(value));
    }
  }

  res.json(getAdapterSettings(id));
});

/** GET /api/adapter-settings/:id/check-auth — check authentication status for an adapter */
router.get('/:id/check-auth', async (req, res) => {
  const { id } = req.params;
  const adapter = adapterRegistry.get(id);
  if (!adapter) {
    res.status(404).json({ error: `Adapter not found: ${id}` });
    return;
  }

  const settings = getAdapterSettings(id);

  if (id === 'claude-code') {
    // Check Claude Code: OAuth keychain → API key in settings → env var
    const keychainToken = await readClaudeKeychainToken();
    const hasApiKey = !!settings.anthropic_api_key;
    const hasEnvKey = !!process.env.ANTHROPIC_API_KEY;

    res.json({
      authenticated: !!(keychainToken || hasApiKey || hasEnvKey),
      source: keychainToken ? 'oauth' : hasApiKey ? 'api_key' : hasEnvKey ? 'env' : undefined,
    });
    return;
  }

  if (id === 'claw-chat') {
    // claw-chat = Agent SDK + display_artifact tool.
    // API key in settings → env var → keychain.
    const provider = settings.api_provider || 'anthropic';
    if (provider === 'openrouter') {
      const hasKey = !!settings.openrouter_api_key;
      res.json({ authenticated: hasKey, source: hasKey ? 'api_key' : undefined });
    } else {
      const hasKey = !!settings.anthropic_api_key;
      const hasEnvKey = !!process.env.ANTHROPIC_API_KEY;
      const keychainToken = await readClaudeKeychainToken();
      res.json({
        authenticated: !!(hasKey || hasEnvKey || keychainToken),
        source: hasKey ? 'api_key' : hasEnvKey ? 'env' : keychainToken ? 'oauth' : undefined,
      });
    }
    return;
  }

  if (id === 'opencode') {
    // OpenCode auth lives at ~/.local/share/opencode/auth.json — we treat
    // the presence of any provider entry as "authenticated". The user
    // creates this file via `opencode auth login` outside the dashboard.
    try {
      const authPath = path.join(os.homedir(), '.local/share/opencode/auth.json');
      const raw = await fsAsync.readFile(authPath, 'utf8');
      const parsed = JSON.parse(raw);
      const ok = parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
      res.json({ authenticated: !!ok, source: ok ? 'cli' : undefined });
    } catch {
      res.json({ authenticated: false });
    }
    return;
  }

  // Generic: check if adapter has any API key configured
  const hasAnyKey = Object.keys(settings).some(k => k.endsWith('_api_key') && settings[k]);
  res.json({ authenticated: hasAnyKey, source: hasAnyKey ? 'api_key' : undefined });
});

/** POST /api/adapter-settings/auto-detect — first-run auto-detection and enable */
router.post('/auto-detect', async (_req, res) => {
  // Only run if no settings exist yet (first launch)
  if (hasAnyAdapterSettings()) {
    res.json({ skipped: true, reason: 'Settings already exist' });
    return;
  }

  const results: Array<{
    adapterId: string;
    displayName: string;
    prerequisitesSatisfied: boolean;
    authenticated: boolean;
    autoEnabled: boolean;
    source?: string;
  }> = [];

  for (const [, adapter] of adapterRegistry.entries()) {
    const id = adapter.metadata.id;
    let prereqOk = true;
    let authenticated = false;
    let source: string | undefined;

    // Check prerequisites
    if (adapter.checkPrerequisites) {
      try {
        const result = await adapter.checkPrerequisites();
        prereqOk = result.satisfied;
      } catch {
        prereqOk = false;
      }
    }

    // Check authentication
    if (id === 'claude-code') {
      const keychainToken = await readClaudeKeychainToken();
      const envKey = process.env.ANTHROPIC_API_KEY;
      authenticated = !!(keychainToken || envKey);
      source = keychainToken ? 'oauth' : envKey ? 'env' : undefined;
    } else if (id === 'claw-chat') {
      const envKey = process.env.ANTHROPIC_API_KEY;
      const keychainToken = await readClaudeKeychainToken();
      authenticated = !!(envKey || keychainToken);
      source = envKey ? 'env' : keychainToken ? 'oauth' : undefined;
    } else if (id === 'opencode') {
      try {
        const authPath = path.join(os.homedir(), '.local/share/opencode/auth.json');
        const raw = await fsAsync.readFile(authPath, 'utf8');
        const parsed = JSON.parse(raw);
        authenticated = parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
        source = authenticated ? 'cli' : undefined;
      } catch {
        authenticated = false;
      }
    }

    // Auto-enable if fully ready
    const autoEnabled = prereqOk && authenticated;
    setAdapterSetting(id, 'enabled', autoEnabled ? 'true' : 'false');

    results.push({
      adapterId: id,
      displayName: adapter.metadata.displayName,
      prerequisitesSatisfied: prereqOk,
      authenticated,
      autoEnabled,
      source,
    });
  }

  res.json({ results });
});

export default router;
