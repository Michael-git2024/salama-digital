// Metadata only. Callers must never pass request bodies, tokens, codes or study content.
export function createAuditRepository(db) {
  return {
    log({ actorId = null, action, entityType = null, entityId = null, outcome = 'success', endpoint = null, ipAddress = null }) {
      db.prepare('INSERT INTO audit_log (ts, actor_id, action, entity_type, entity_id, outcome, endpoint, ip_address) VALUES (?,?,?,?,?,?,?,?)')
        .run(new Date().toISOString(), actorId, action, entityType, entityId, outcome, endpoint, ipAddress);
    },
    list: (limit = 200) => db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(limit, 1000)),
  };
}
