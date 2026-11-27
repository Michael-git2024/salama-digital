import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';

export function userRoutes({ authService, users, audit }) {
  const r = Router();
  r.use(requirePermission('users:manage', audit));
  r.get('/', (_req, res) => res.json(users.list()));
  r.post('/', async (req, res, next) => {
    try {
      const { username, displayName, role, temporaryPassword } = req.body || {};
      const u = await authService.createUser({ username, displayName, role, password: temporaryPassword, actorId: req.user.id });
      res.status(201).json({ id: u.id, username: u.username, role: u.role });
    } catch (e) { next(e); }
  });
  r.post('/:id/deactivate', (req, res, next) => { try { authService.setActive(req.user.id, req.params.id, false); res.json({ ok: true }); } catch (e) { next(e); } });
  r.post('/:id/reactivate', (req, res, next) => { try { authService.setActive(req.user.id, req.params.id, true); res.json({ ok: true }); } catch (e) { next(e); } });
  return r;
}
