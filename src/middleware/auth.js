import { HttpError } from '../lib/errors.js';
import { can, ROLES, INSTITUTIONAL_PARTNER_ROLES, FORBIDDEN_PARTNER_PATHS } from '../auth/roles.js';

export const COOKIE = 'sd_session';

// Tokens are accepted ONLY from the httpOnly cookie or the Authorization header, never from URLs.
export function attachUser(authService) {
  return (req, _res, next) => {
    const h = req.headers.authorization;
    const token = req.cookies?.[COOKIE] || (h?.startsWith('Bearer ') ? h.slice(7) : null);
    req.user = null;
    if (token) {
      try { req.user = authService.authenticate(token); } catch { /* stays null => public_visitor */ }
    }
    next();
  };
}

export const requireAuth = (req, _res, next) =>
  next(req.user ? undefined : new HttpError(401, 'unauthenticated', 'Authentication required.'));

// External institutional partners (Police/DCI, Court/ODPP) can NEVER touch raw records,
// survivor demographics, PI datasets or any write surface — regardless of path aliasing.
export function blockInstitutionalPartners(audit) {
  return (req, _res, next) => {
    const role = req.user?.role;
    if (!role || !INSTITUTIONAL_PARTNER_ROLES.includes(role)) return next();
    const path = req.path.replace(/\.(html|json)$/, '');
    if (FORBIDDEN_PARTNER_PATHS.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '.html'))) {
      audit?.log({ actorId: req.user.id, action: `denied:partner:${req.method}${path}`, outcome: 'denied', endpoint: req.originalUrl, ipAddress: req.ip });
      return next(new HttpError(403, 'forbidden', 'Institutional partner accounts are restricted to aggregate metrics only.'));
    }
    next();
  };
}

// Sessions that still owe MFA enrolment or a password change can only use /api/auth/* (which uses requireAuth).
export function requirePermission(perm, audit) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'unauthenticated', 'Authentication required.'));
    if (req.user.mustChangePassword) return next(new HttpError(403, 'password_change_required', 'Change your password first.'));
    if (req.user.mfaEnrollmentRequired) return next(new HttpError(403, 'mfa_enrollment_required', 'Enrol in MFA first.'));
    if (!can(req.user.role ?? ROLES.PUBLIC, perm)) {
      audit?.log({ actorId: req.user.id, action: `denied:${perm}`, outcome: 'denied' });
      return next(new HttpError(403, 'forbidden', 'You do not have permission for this resource.'));
    }
    next();
  };
}
