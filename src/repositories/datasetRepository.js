export function createDatasetRepository(db) {
  return {
    create({ id, code, title, tier }) {
      db.prepare('INSERT INTO datasets (id, code, title, tier, created_at) VALUES (?,?,?,?,?)').run(id, code, title, tier, new Date().toISOString());
    },
    listByTier: (tier) => db.prepare('SELECT id, code, title, tier, created_at FROM datasets WHERE tier = ? ORDER BY code').all(tier),
  };
}
