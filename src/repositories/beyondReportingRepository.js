// All SQL for the "Beyond Reporting" tables (migration 002). Swap for Postgres later
// by re-implementing against pg with the same method signatures.
// Rows are de-identified abstractions only; any direct identifier is rejected upstream
// by lib/piiValidator.js before it ever reaches this code.
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();

const RETENTION_TIERS = ['active', 'flagged_for_deletion', 'anonymized'];

// camelCase input -> snake_case DB columns
const cols = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()), v]));

function insertAbstraction(db, table, fields) {
  const f = cols(fields);
  const id = randomUUID();
  const t = now();
  const keys = Object.keys(f);
  db.prepare(`INSERT INTO ${table} (id, ${keys.join(', ')}, created_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`)
    .run(id, ...keys.map((k) => f[k]), t);
  return { id, ...f, created_at: t };
}

export function createBeyondReportingRepository(db) {

  return {
    // ---- ingestion (police / odpp+courts / health) ----
    insertPoliceAbstraction(fields) { return insertAbstraction(db, 'police_abstractions', fields); },
    insertOdppAbstraction(fields) { return insertAbstraction(db, 'odpp_court_abstractions', fields); },
    insertHealthAbstraction(fields) { return insertAbstraction(db, 'health_gbvrc_abstractions', fields); },
    listPoliceAbstractions: () => db.prepare('SELECT * FROM police_abstractions ORDER BY created_at').all(),
    listOdppAbstractions: () => db.prepare('SELECT * FROM odpp_court_abstractions ORDER BY created_at').all(),
    listHealthAbstractions: () => db.prepare('SELECT * FROM health_gbvrc_abstractions ORDER BY created_at').all(),

    // ---- linkage (PI-authorized only) ----
    createLinkageAuthorization({ issuedBy, purpose, expiresAt }) {
      const token = randomUUID();
      db.prepare('INSERT INTO linkage_authorizations (token, issued_by, purpose, expires_at, created_at) VALUES (?,?,?,?,?)')
        .run(token, issuedBy, purpose, expiresAt, now());
      return { token, issuedBy, purpose, expiresAt };
    },
    activeLinkageToken(token) {
      const t = db.prepare('SELECT * FROM linkage_authorizations WHERE token = ?').get(token);
      return t && !t.revoked_at && new Date(t.expires_at) > new Date() ? t : null;
    },
    createRecordLink({ sourceInstitution, sourceRecordId, targetInstitution, targetRecordId, authorizationToken, linkedBy }) {
      if (!this.activeLinkageToken(authorizationToken)) throw new Error('no_active_authorization');
      const id = randomUUID();
      db.prepare(`INSERT INTO record_links (id, source_institution, source_record_id, target_institution, target_record_id, authorization_token, linked_by, created_at)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, sourceInstitution, sourceRecordId, targetInstitution, targetRecordId, authorizationToken, linkedBy, now());
      return { id, sourceInstitution, targetInstitution };
    },
    listRecordLinks: () => db.prepare('SELECT * FROM record_links ORDER BY created_at').all(),

    // ---- service directory & readiness ----
    insertService(s) {
      const id = randomUUID();
      db.prepare(`INSERT INTO services (id, name, type, county, sub_county, verified, open_24_7, private_room, operating_hours_verified, staffing_adequate, last_audited_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, s.name, s.type, s.county, s.subCounty, s.verified === undefined ? 1 : s.verified ? 1 : 0,
          s.open247 ? 1 : 0, s.privateRoom ? 1 : 0, s.operatingHoursVerified === undefined ? 1 : s.operatingHoursVerified ? 1 : 0,
          s.staffingAdequate ?? 'Yes', now());
      return this.getService(id);
    },
    getService: (id) => db.prepare('SELECT * FROM services WHERE id = ?').get(id),
    listServices: () => db.prepare('SELECT * FROM services ORDER BY county, name').all(),

    // ---- referrals (status preserves 'Not Completed' vs 'Not Documented') ----
    insertReferral(r) {
      const id = randomUUID();
      const t = now();
      db.prepare(`INSERT INTO referrals (id, coded_record_id, from_service_id, to_service_id, county, category, status, status_notes, created_by, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, r.codedRecordId, r.fromServiceId ?? null, r.toServiceId, r.county, r.category, r.status ?? 'Initiated', r.statusNotes ?? null, r.createdBy, t, t);
      return this.getReferral(id);
    },
    getReferral: (id) => db.prepare('SELECT * FROM referrals WHERE id = ?').get(id),
    updateReferralStatus(id, status, statusNotes) {
      const allowed = ['Initiated', 'Completed', 'Not Completed', 'Not Documented'];
      if (!allowed.includes(status)) throw new Error('invalid_referral_status');
      db.prepare('UPDATE referrals SET status = ?, status_notes = ?, updated_at = ? WHERE id = ?')
        .run(status, statusNotes ?? null, now(), id);
      return this.getReferral(id);
    },
    listReferrals: () => db.prepare('SELECT * FROM referrals ORDER BY created_at').all(),

    // ---- aggregate analytics with small-cell suppression (min cell = 5) ----
    aggregate({ groupBy = 'county', category = null }) {
      const col = ['county', 'site_type', 'age_band', 'sex'].includes(groupBy) ? groupBy : 'county';
      const rows = category
        ? db.prepare(`SELECT ${col} AS bucket, COUNT(*) AS n FROM research_records WHERE category = ? GROUP BY ${col}`).all(category)
        : db.prepare(`SELECT ${col} AS bucket, COUNT(*) AS n FROM research_records GROUP BY ${col}`).all();
      // small-cell suppression: hide any group with fewer than 5 individuals
      return rows.map((r) => ({ bucket: r.bucket, count: r.n >= 5 ? r.n : null, suppressed: r.n < 5 }));
    },
    insertResearchRecord(r) {
      const id = randomUUID();
      db.prepare(`INSERT INTO research_records (id, study_id, county, site_type, age_band, sex, category, referral_status, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, r.studyId, r.county, r.siteType, r.ageBand, r.sex ?? 'Female', r.category, r.referralStatus, now());
      return { id, ...r };
    },

    // ---- retention lifecycle ----
    setRetentionStatus(table, id, status) {
      if (!RETENTION_TIERS.includes(status)) throw new Error('invalid_retention_status');
      const info = db.prepare(`UPDATE ${table} SET retention_status = ? WHERE id = ?`).run(status, id);
      if (info.changes === 0) throw new Error('not_found');
      return true;
    },
  };
}
