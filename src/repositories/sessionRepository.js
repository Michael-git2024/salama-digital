import { randomUUID } from 'node:crypto';

export function createSessionRepository(db) {
  return {
    create(userId, expiresAt) {
      const id = randomUUID(); const t = new Date().toISOString();
      db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)').run(id, userId, t, t, expiresAt);
      return id;
    },
    find: (id) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id),
    touch: (id) => db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id),
    revoke: (id) => db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(new Date().toISOString(), id),
    revokeAllForUser: (userId) => db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), userId),
  };
}
