// Repository pattern: all SQL for users lives here. To move to PostgreSQL, re-implement these
// repositories against pg (same method signatures); services/routes never touch SQL.
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();

export function createUserRepository(db) {
  const q = (sql) => db.prepare(sql);
  return {
    create({ username, displayName, passwordHash, role, mustChangePassword = false }) {
      const id = randomUUID(); const t = now();
      q(`INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`).run(id, username, displayName, passwordHash, role, mustChangePassword ? 1 : 0, t, t);
      return this.findById(id);
    },
    findById: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
    findByUsername: (u) => q('SELECT * FROM users WHERE username = ?').get(u),
    list: () => q(`SELECT id, username, display_name, role, is_active, mfa_enabled, created_at, deactivated_at
                   FROM users ORDER BY created_at`).all(),
    setActive(id, active) {
      q('UPDATE users SET is_active = ?, deactivated_at = ?, updated_at = ? WHERE id = ?')
        .run(active ? 1 : 0, active ? null : now(), now(), id);
    },
    recordFailedLogin(id, maxFailed, lockoutMinutes) {
      const u = this.findById(id);
      const n = u.failed_logins + 1;
      const lock = n >= maxFailed ? new Date(Date.now() + lockoutMinutes * 60000).toISOString() : null;
      q('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?')
        .run(lock ? 0 : n, lock, now(), id);
    },
    resetFailures: (id) => q('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(id),
    setMfa: (id, secretEnc, enabled) =>
      q('UPDATE users SET mfa_secret_enc = ?, mfa_enabled = ?, updated_at = ? WHERE id = ?').run(secretEnc, enabled ? 1 : 0, now(), id),
    updatePassword: (id, hash, mustChange = false) =>
      q('UPDATE users SET password_hash = ?, must_change_password = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
        .run(hash, mustChange ? 1 : 0, now(), id),
  };
}
