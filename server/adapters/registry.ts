/**
 * ChatAdapterRegistry — singleton that manages all registered chat adapters.
 *
 * Adapters register themselves during startup (via loader.ts auto-discovery).
 * The adapter orchestrator and wire-events use this to look up adapters by ID.
 */

import type { IChatAdapterServer } from './types.ts';
import type { AdapterMetadata } from '../../shared/types/adapter.ts';

class ChatAdapterRegistry {
  private adapters = new Map<string, IChatAdapterServer>();

  /** Register an adapter instance */
  register(adapter: IChatAdapterServer): void {
    const id = adapter.metadata.id;
    if (this.adapters.has(id)) {
      throw new Error(`Adapter "${id}" is already registered`);
    }
    this.adapters.set(id, adapter);
    console.log(`[adapters] Registered adapter: ${adapter.metadata.displayName} (${id})`);
  }

  /** Get an adapter by its ID */
  get(adapterId: string): IChatAdapterServer | undefined {
    return this.adapters.get(adapterId);
  }

  /** Check if an adapter is registered */
  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  /** List all registered adapter metadata (for REST API / settings UI) */
  listMetadata(): AdapterMetadata[] {
    return Array.from(this.adapters.values()).map(a => a.metadata);
  }

  /** Iterate over all adapters */
  entries(): IterableIterator<[string, IChatAdapterServer]> {
    return this.adapters.entries();
  }

  /** Shut down all adapters (server shutdown) */
  shutdownAll(): void {
    for (const [id, adapter] of this.adapters) {
      try {
        adapter.endAll();
      } catch (err) {
        console.error(`[adapters] Error shutting down adapter "${id}":`, err);
      }
    }
  }
}

export const adapterRegistry = new ChatAdapterRegistry();
