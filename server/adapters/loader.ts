/**
 * Adapter auto-discovery loader.
 *
 * Scans the adapters/ directory for subdirectories with a server.ts file,
 * imports each one, instantiates the adapter, and registers it in the registry.
 *
 * To add a new adapter: create adapters/<name>/server.ts exporting a default
 * class that implements IChatAdapterServer. No other files need to be modified.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterRegistry } from './registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = path.resolve(__dirname, '../../adapters');

export async function loadAdapters(): Promise<void> {
  if (!fs.existsSync(ADAPTERS_DIR)) {
    console.warn(`[adapters] Adapters directory not found: ${ADAPTERS_DIR}`);
    return;
  }

  const entries = fs.readdirSync(ADAPTERS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const adapterDir = path.join(ADAPTERS_DIR, entry.name);

    // Look for server.ts (or compiled server.js)
    const serverTsPath = path.join(adapterDir, 'server.ts');
    const serverJsPath = path.join(adapterDir, 'server.js');
    const serverPath = fs.existsSync(serverTsPath) ? serverTsPath : fs.existsSync(serverJsPath) ? serverJsPath : null;

    if (!serverPath) {
      continue; // Skip directories without a server module
    }

    try {
      const mod = await import(serverPath);
      const AdapterClass = mod.default;

      if (typeof AdapterClass !== 'function') {
        console.warn(`[adapters] ${entry.name}/server.ts does not export a default class, skipping`);
        continue;
      }

      const adapter = new AdapterClass();
      adapterRegistry.register(adapter);
    } catch (err) {
      console.error(`[adapters] Failed to load adapter from ${entry.name}/:`, err);
    }
  }
}
