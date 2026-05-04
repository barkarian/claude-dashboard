/**
 * REST API routes for adapter discovery and management.
 */

import { Router } from 'express';
import { adapterRegistry } from '../adapters/registry.ts';

const router = Router();

/** GET /api/adapters — list all registered adapters with their metadata */
router.get('/', (_req, res) => {
  res.json(adapterRegistry.listMetadata());
});

/** GET /api/adapters/:id/prerequisites — check if an adapter's prerequisites are met */
router.get('/:id/prerequisites', async (req, res) => {
  const adapter = adapterRegistry.get(req.params.id);
  if (!adapter) {
    res.status(404).json({ error: `Adapter not found: ${req.params.id}` });
    return;
  }

  if (!adapter.checkPrerequisites) {
    res.json({ satisfied: true });
    return;
  }

  try {
    const result = await adapter.checkPrerequisites();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ satisfied: false, message: err.message });
  }
});

/** GET /api/adapters/:id/models — list models the adapter can use */
router.get('/:id/models', async (req, res) => {
  const adapter = adapterRegistry.get(req.params.id);
  if (!adapter) {
    res.status(404).json({ error: `Adapter not found: ${req.params.id}` });
    return;
  }

  if (!adapter.listModels) {
    res.json({ models: [] });
    return;
  }

  try {
    const models = await adapter.listModels();
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list models' });
  }
});

export default router;
