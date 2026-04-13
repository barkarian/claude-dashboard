/**
 * Client-side adapter auto-discovery loader.
 *
 * Uses Vite's import.meta.glob to eagerly import all adapter client registrations.
 * Each adapter's client/index.ts calls registerClientAdapter() as a side effect.
 *
 * Import this file once in main.tsx or App.tsx to load all adapters.
 */

// Eagerly import all adapter client modules — each one self-registers.
// The relative path goes from client/src/adapters/ up to the project root's adapters/ dir.
const modules = import.meta.glob('../../../adapters/*/client/index.ts', { eager: true });

// Log loaded adapters
const adapterNames = Object.keys(modules).map(p => {
  const match = p.match(/adapters\/([^/]+)\/client/);
  return match ? match[1] : 'unknown';
});
if (adapterNames.length > 0) {
  console.log(`[adapters] Loaded client adapters: ${adapterNames.join(', ')}`);
}
