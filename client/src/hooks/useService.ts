import { useEffect, useState, useCallback } from 'react';
import api from '../utils/api.ts';

export interface Service {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
}

export function useServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    api.get<{ services: Service[] }>('/api/services')
      .then(d => setServices(d.services))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { services, loading, refresh };
}

export function useService(id: string) {
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    api.get<{ service: Service }>(`/api/services/${id}`)
      .then(d => setService(d.service))
      .catch(() => setService(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const data = await api.patch<{ service: Service }>(`/api/services/${id}`, { enabled });
    setService(data.service);
  }, [id]);

  return { service, loading, enabled: service?.enabled ?? null, setEnabled, refresh };
}
