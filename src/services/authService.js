import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { HttpError } from '../lib/errors.js';
import { encryptField, decryptField } from '../lib/crypto.js';
import { ACCOUNT_ROLES } from '../auth/roles.js';

authenticator.options = { window: 1 };
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 12) throw new HttpError(400, 'weak_password', 'Password must be at least 12 characters.');
  if (pw.length > 128) throw new HttpError(400, 'weak_password', 'Password too long.');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) throw new HttpError(400, 'weak_password', 'Password must mix letters with numbers or symbols.');
}

export function createAuthService({ config, users, sessions, audit }) {
  const hashPassword = (pw) => bcrypt.hash(pw, config.bcryptCost || 12);
  const mfaRequiredFor = (u) => config.mfaRequiredRoles.includes(u.role);

  async function createUser({ username, displayName, password, role, actorId, mustChangePassword = true }) {
    if (!ACCOUNT_ROLES.includes(role)) throw new HttpError(400, 'invalid_role', 'Role cannot hold an account.');
    if (!/^[a-z0-9._-]{3,40}$/.test(username || '')) throw new HttpError(400, 'invalid_username', 'Username: 3-40 chars a-z 0-9 . _ -');
    if (!displayName || displayName.length > 100) throw new HttpError(400, 'invalid_name', 'Display name required.');
    validatePassword(password);
    if (users.findByUsername(username)) throw new HttpError(409, 'username_taken', 'Username already exists.');
    const u = users.create({ username, displayName, passwordHash: await hashPassword(password), role, mustChangePassword });
    audit.log({ actorId, action: 'user.create', entityType: 'user', entityId: u.id });
    return u;
  }

  async function login({ username, password, totp }) {
    const u = typeof username === 'string' ? users.findByUsername(username.toLowerCase()) : null;
    if (!u || typeof password !== 'string') {
      await bcrypt.compare(String(password || ''), DUMMY_HASH); // equalise timing
      audit.log({ action: 'auth.login', outcome: 'failure' });
      throw new HttpError(401, 'invalid_credentials', 'Invalid credentials.');
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      audit.log({ actorId: u.id, action: 'auth.login.locked', outcome: 'denied' });
      throw new HttpError(429, 'locked', 'Too many failed attempts. Try again later.');
    }
    const okPw = await bcrypt.compare(password, u.password_hash);
    if (!okPw || !u.is_active) {
      if (okPw === false) users.recordFailedLogin(u.id, config.maxFailedLogins, config.lockoutMinutes);
      audit.log({ actorId: u.id, action: u.is_active ? 'auth.login' : 'auth.login.inactive', outcome: 'failure' });
      throw new HttpError(401, 'invalid_credentials', 'Invalid credentials.'); // same message for inactive: no account enumeration
    }
    if (u.mfa_enabled) {
      if (!totp) throw new HttpError(401, 'mfa_required', 'Authentication code required.');
      const ok = authenticator.check(String(totp), decryptField(u.mfa_secret_enc, config.mfaEncKey));
      if (!ok) {
        users.recordFailedLogin(u.id, config.maxFailedLogins, config.lockoutMinutes);
        audit.log({ actorId: u.id, action: 'auth.mfa', outcome: 'failure' });
        throw new HttpError(401, 'invalid_credentials', 'Invalid credentials.');
      }
    }
    users.resetFailures(u.id);
    const exp = new Date(Date.now() + config.sessionMaxHours * 3600000);
    const jti = sessions.create(u.id, exp.toISOString());
    const token = jwt.sign({ sub: u.id, jti }, config.jwtSecret, { algorithm: 'HS256', expiresIn: Math.floor((exp - Date.now()) / 1000) });
    audit.log({ actorId: u.id, action: 'auth.login', outcome: 'success' });
    return { token, user: u };
  }

  // Returns the authenticated principal or throws 401. Enforces revocation, absolute + idle expiry, deactivation.
  function authenticate(token) {
    let p;
    try { p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }); } catch { throw new HttpError(401, 'unauthenticated', 'Authentication required.'); }
    const s = sessions.find(p.jti);
    const u = s && users.findById(s.user_id);
    const idleLimit = config.sessionIdleMinutes * 60000;
    if (!s || !u || s.revoked_at || !u.is_active || new Date(s.expires_at) < new Date()
        || Date.now() - new Date(s.last_seen_at).getTime() > idleLimit) {
      if (s && !s.revoked_at) sessions.revoke(s.id);
      throw new HttpError(401, 'unauthenticated', 'Authentication required.');
    }
    sessions.touch(s.id);
    return {
      id: u.id, username: u.username, displayName: u.display_name, role: u.role, sessionId: s.id,
      mfaEnabled: !!u.mfa_enabled,
      mfaEnrollmentRequired: mfaRequiredFor(u) && !u.mfa_enabled,
      mustChangePassword: !!u.must_change_password,
    };
  }

  const logout = (sessionId, actorId) => { sessions.revoke(sessionId); audit.log({ actorId, action: 'auth.logout' }); };

  function beginMfaEnrollment(user) {
    const secret = authenticator.generateSecret();
    users.setMfa(user.id, encryptField(secret, config.mfaEncKey), false);
    return { secret, otpauthUrl: authenticator.keyuri(user.username, 'Salama Digital', secret) };
  }
  function confirmMfa(user, code) {
    const row = users.findById(user.id);
    if (!row.mfa_secret_enc) throw new HttpError(400, 'mfa_not_started', 'Start enrolment first.');
    if (!authenticator.check(String(code), decryptField(row.mfa_secret_enc, config.mfaEncKey))) throw new HttpError(400, 'invalid_code', 'Invalid code.');
    users.setMfa(user.id, row.mfa_secret_enc, true);
    audit.log({ actorId: user.id, action: 'auth.mfa.enable' });
  }

  async function changePassword(user, current, next) {
    const row = users.findById(user.id);
    if (!(await bcrypt.compare(String(current || ''), row.password_hash))) throw new HttpError(401, 'invalid_credentials', 'Current password incorrect.');
    validatePassword(next);
    users.updatePassword(user.id, await hashPassword(next), false);
    sessions.revokeAllForUser(user.id); // force re-login everywhere
    audit.log({ actorId: user.id, action: 'auth.password.change' });
  }

  function setActive(actorId, targetId, active) {
    const t = users.findById(targetId);
    if (!t) throw new HttpError(404, 'not_found', 'User not found.');
    if (actorId === targetId && !active) throw new HttpError(400, 'self_deactivate', 'You cannot deactivate your own account.');
    users.setActive(targetId, active);
    if (!active) sessions.revokeAllForUser(targetId);
    audit.log({ actorId, action: active ? 'user.reactivate' : 'user.deactivate', entityType: 'user', entityId: targetId });
  }

  return { hashPassword, createUser, login, authenticate, logout, beginMfaEnrollment, confirmMfa, changePassword, setActive };
}
