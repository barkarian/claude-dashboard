import { Router, type Request, type Response } from 'express';
import { getSetting, setSetting } from '../services/database.ts';

/**
 * Service Catalog — global per-user, always-on capabilities (no agent.md, no per-workspace toggle).
 *
 * Distinct from "Apps" (which are per-workspace skills tied to chat adapters).
 * Each service has an enabled flag stored in the global `settings` table under
 * the key `service.<id>.enabled` ("true" / "false"). Unset = the service's
 * default (preserves pre-Catalog behavior on first boot).
 */

interface ServiceMeta {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
}

const SERVICES: ServiceMeta[] = [
  {
    id: 'local-computer',
    name: 'Local Computer',
    description: 'See open ports on your machine and shut it down remotely.',
    defaultEnabled: true,
  },
];

function isEnabled(s: ServiceMeta): boolean {
  const v = getSetting(`service.${s.id}.enabled`);
  if (v === undefined) return s.defaultEnabled;
  return v === 'true';
}

/** Lookup helper used by other routes (e.g. system.ts) to gate features. */
export function isServiceEnabled(id: string): boolean {
  const s = SERVICES.find(x => x.id === id);
  if (!s) return false;
  return isEnabled(s);
}

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const services = SERVICES.map(s => ({ ...s, enabled: isEnabled(s) }));
  res.json({ services });
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const s = SERVICES.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Service not found' });
  res.json({ service: { ...s, enabled: isEnabled(s) } });
});

router.patch('/:id', (req: Request<{ id: string }>, res: Response) => {
  const s = SERVICES.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Service not found' });
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  setSetting(`service.${s.id}.enabled`, enabled ? 'true' : 'false');
  res.json({ service: { ...s, enabled } });
});

export default router;
