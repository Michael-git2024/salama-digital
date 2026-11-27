import { Router } from 'express';
import { COOKIE, requireAuth } from '../middleware/auth.js';
import { permissionsFor } from '../auth/roles.js';

export function authRoutes({ config, authService }) {
  const r = Router();
  const cookieOpts = () => ({ httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', maxAge: config.sessionMaxHours * 3600000 });

  r.post('/login', async (req, res, next) => {
    try {
      const { token, user } = await authService.login(req.body || {});
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ user: { username: user.username, displayName: user.display_name, role: user.role } });
    } catch (e) { next(e); }
  });
  r.post('/logout', requireAuth, (req, res) => {
    authService.logout(req.user.sessionId, req.user.id);
    res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true });
  });
  r.get('/me', requireAuth, (req, res) => {
    const u = req.user;
    res.json({ username: u.username, displayName: u.displayName, role: u.role, mfaEnabled: u.mfaEnabled,
      mfaEnrollmentRequired: u.mfaEnrollmentRequired, mustChangePassword: u.mustChangePassword,
      permissions: (u.mfaEnrollmentRequired || u.mustChangePassword) ? [] : permissionsFor(u.role) });
  });
  r.post('/mfa/enroll', requireAuth, (req, res) => res.json(authService.beginMfaEnrollment(req.user)));
  r.post('/mfa/confirm', requireAuth, (req, res, next) => {
    try { authService.confirmMfa(req.user, req.body?.code); res.json({ ok: true }); } catch (e) { next(e); }
  });
  r.post('/change-password', requireAuth, async (req, res, next) => {
    try {
      await authService.changePassword(req.user, req.body?.currentPassword, req.body?.newPassword);
      res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true, reloginRequired: true });
    } catch (e) { next(e); }
  });
  return r;
}
