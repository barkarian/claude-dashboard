/**
 * useAdapterSettings — fetches and manages per-adapter settings.
 *
 * Combines data from:
 * - GET /api/adapters (metadata)
 * - GET /api/adapter-settings (current config)
 * - GET /api/adapters/:id/prerequisites (per adapter)
 * - GET /api/adapter-settings/:id/check-auth (per adapter)
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api.ts';
import type { AdapterMetadata, PrerequisiteResult } from '../../../shared/types/adapter.ts';

export interface AdapterInfo {
  metadata: AdapterMetadata;
  settings: Record<string, string>;
  prerequisites: PrerequisiteResult | null;
  authStatus: { authenticated: boolean; source?: string } | null;
  enabled: boolean;
}

export interface AdapterSettingsState {
  adapters: AdapterInfo[];
  enabledIds: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  updateSettings: (adapterId: string, updates: Record<string, string | null>) => Promise<void>;
  toggleEnabled: (adapterId: string, enabled: boolean) => Promise<void>;
}

export function useAdapterSettings(): AdapterSettingsState {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch metadata and settings in parallel
      const [metadataList, allSettings] = await Promise.all([
        api.get<AdapterMetadata[]>('/api/adapters'),
        api.get<Record<string, Record<string, string>>>('/api/adapter-settings'),
      ]);

      // Fetch prerequisites and auth status for each adapter in parallel
      const enriched = await Promise.all(
        metadataList.map(async (metadata) => {
          const settings = allSettings[metadata.id] || {};

          let prerequisites: PrerequisiteResult | null = null;
          if (metadata.capabilities.prerequisites) {
            try {
              prerequisites = await api.get<PrerequisiteResult>(`/api/adapters/${metadata.id}/prerequisites`);
            } catch {
              prerequisites = { satisfied: false, message: 'Failed to check prerequisites' };
            }
          }

          let authStatus: { authenticated: boolean; source?: string } | null = null;
          try {
            authStatus = await api.get<{ authenticated: boolean; source?: string }>(
              `/api/adapter-settings/${metadata.id}/check-auth`
            );
          } catch {
            authStatus = null;
          }

          return {
            metadata,
            settings,
            prerequisites,
            authStatus,
            enabled: settings.enabled === 'true',
          };
        })
      );

      setAdapters(enriched);
    } catch (err: any) {
      setError(err.message || 'Failed to load adapter settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateSettings = useCallback(async (adapterId: string, updates: Record<string, string | null>) => {
    await api.put(`/api/adapter-settings/${adapterId}`, updates);
    // Refresh to get updated state
    await fetchAll();
  }, [fetchAll]);

  const toggleEnabled = useCallback(async (adapterId: string, enabled: boolean) => {
    await api.put(`/api/adapter-settings/${adapterId}`, { enabled: enabled ? 'true' : 'false' });
    await fetchAll();
  }, [fetchAll]);

  const enabledIds = adapters.filter(a => a.enabled).map(a => a.metadata.id);

  return {
    adapters,
    enabledIds,
    loading,
    error,
    refresh: fetchAll,
    updateSettings,
    toggleEnabled,
  };
}
