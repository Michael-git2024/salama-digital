import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';

// Reads real rows only. Returns [] when the table is empty - never demo data.
export function researchRoutes({ datasets, audit }) {
  const r = Router();
  r.get('/datasets/pi-restricted', requirePermission('datasets:pi:read', audit), (req, res) => {
    audit.log({ actorId: req.user.id, action: 'dataset.list', entityType: 'dataset_tier', entityId: 'pi_restricted' });
    res.json(datasets.listByTier('pi_restricted'));
  });
  r.get('/audit', requirePermission('audit:read', audit), (_req, res) => res.json(audit.list(200)));
  return r;
}
