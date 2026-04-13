/**
 * Client-side adapter registry.
 *
 * Adapters register themselves via registerClientAdapter().
 * The ChatViewShell uses getClientAdapter() to look up the correct view component.
 */

import type { ClientChatAdapter } from './types.ts';
import type { AdapterMetadata } from '../../../shared/types/adapter.ts';

const clientAdapters = new Map<string, ClientChatAdapter>();

/** Register a client adapter. Called by each adapter's client/index.ts */
export function registerClientAdapter(adapter: ClientChatAdapter): void {
  if (clientAdapters.has(adapter.id)) {
    console.warn(`[adapters] Client adapter "${adapter.id}" already registered, replacing`);
  }
  clientAdapters.set(adapter.id, adapter);
}

/** Get a client adapter by its ID */
export function getClientAdapter(id: string): ClientChatAdapter | undefined {
  return clientAdapters.get(id);
}

/** List all registered client adapters */
export function listClientAdapters(): ClientChatAdapter[] {
  return Array.from(clientAdapters.values());
}

/** List all registered adapter metadata */
export function listAdapterMetadata(): AdapterMetadata[] {
  return Array.from(clientAdapters.values()).map(a => a.metadata);
}
