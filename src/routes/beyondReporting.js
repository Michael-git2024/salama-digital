import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { extractAndValidateDeidentified } from '../lib/piiValidator.js';
import { HttpError } from '../lib/errors.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// "Beyond Reporting" layer: institutional ingestion, linkage, referrals, readiness, retention.
// All bodies pass through the de-identification validator: direct identifiers => 422, never stored.
export function beyondReportingRoutes({ beyond, audit }) {
  const r = Router();

  const auditLog = (req, action, entityId = null) =>
    audit.log({
      actorId: req.user.id, action, entityType: 'beyond_reporting', entityId,
      endpoint: req.originalUrl, ipAddress: req.ip
    });

  // ---- ingestion ----
  r.post('/ingest/police', requirePermission('ingest:police', audit), (req, res, next) => {
    try {
      const records = extractAndValidateDeidentified(req.body);
      const saved = records.map((rec) => beyond.insertPoliceAbstraction({
        codedRef: str(rec.coded_ref), county: str(rec.county), offenceCategory: str(rec.offence_category),
        p3Issued: str(rec.p3_issued) || 'No', referralInitiated: str(rec.referral_initiated) || 'No',
        recordPeriod: str(rec.record_period), createdBy: req.user.id,
      }));
      auditLog(req, 'ingest.police', `${saved.length} records`);
      res.status(201).json({ count: saved.length });
    } catch (e) { next(e); }
  });

  r.post('/ingest/odpp', requirePermission('ingest:odpp', audit), (req, res, next) => {
    try {
      const records = extractAndValidateDeidentified(req.body);
      const saved = records.map((rec) => beyond.insertOdppAbstraction({
        codedRef: str(rec.coded_ref), county: str(rec.county), offenceCategory: str(rec.offence_category),
        caseProgression: str(rec.case_progression) || 'Pending', trialOutcome: str(rec.trial_outcome),
        recordPeriod: str(rec.record_period), createdBy: req.user.id,
      }));
      auditLog(req, 'ingest.odpp', `${saved.length} records`);
      res.status(201).json({ count: saved.length });
    } catch (e) { next(e); }
  });

  r.post('/ingest/health', requirePermission('ingest:health', audit), (req, res, next) => {
    try {
      const records = extractAndValidateDeidentified(req.body);
      const saved = records.map((rec) => beyond.insertHealthAbstraction({
        county: str(rec.county), siteType: str(rec.site_type) || 'Urban', ageBand: str(rec.age_band) || '18-24',
        sex: str(rec.sex) || 'Female', category: str(rec.category), attendanceCount: Number(rec.attendance_count) || 1,
        clinicalReferral: str(rec.clinical_referral) || 'No', serviceUtilization: str(rec.service_utilization),
        recordPeriod: str(rec.record_period), createdBy: req.user.id,
      }));
      auditLog(req, 'ingest.health', `${saved.length} records`);
      res.status(201).json({ count: saved.length });
    } catch (e) { next(e); }
  });

  r.get('/police', requirePermission('ingest:police', audit), (req, res) => { res.json(beyond.listPoliceAbstractions()); auditLog(req, 'ingest.police.list'); });
  r.get('/odpp', requirePermission('ingest:odpp', audit), (req, res) => { res.json(beyond.listOdppAbstractions()); auditLog(req, 'ingest.odpp.list'); });
  r.get('/health', requirePermission('ingest:health', audit), (req, res) => { res.json(beyond.listHealthAbstractions()); auditLog(req, 'ingest.health.list'); });

  // ---- linkage: token issued by PI only; links created only with an active PI token ----
  r.post('/linkage/authorize', requirePermission('linkage:authorize', audit), (req, res, next) => {
    try {
      const purpose = str(req.body?.purpose);
      const days = Number(req.body?.validDays) || 7;
      if (!purpose) throw new HttpError(400, 'invalid_payload', 'purpose is required.');
      const auth = beyond.createLinkageAuthorization({
        issuedBy: req.user.id, purpose,
        expiresAt: new Date(Date.now() + Math.min(days, 30) * 86400000).toISOString(),
      });
      auditLog(req, 'linkage.authorize', auth.token.slice(0, 8));
      res.status(201).json({ token: auth.token, expiresAt: auth.expiresAt });
    } catch (e) { next(e); }
  });

  r.post('/linkage/records', requirePermission('records:link', audit), (req, res, next) => {
    try {
      const { authorizationToken } = req.body || {};
      if (!beyond.activeLinkageToken(String(authorizationToken || ''))) {
        throw new HttpError(403, 'no_active_authorization', 'Valid PI-issued authorization token required.');
      }
      const b = req.body || {};
      const link = beyond.createRecordLink({
        sourceInstitution: str(b.sourceInstitution), sourceRecordId: str(b.sourceRecordId),
        targetInstitution: str(b.targetInstitution), targetRecordId: str(b.targetRecordId),
        authorizationToken: String(authorizationToken), linkedBy: req.user.id,
      });
      auditLog(req, 'records.link', link.id);
      res.status(201).json(link);
    } catch (e) { next(e); }
  });

  r.get('/linkage/records', requirePermission('records:link', audit), (req, res) => {
    res.json(beyond.listRecordLinks()); auditLog(req, 'records.link.list');
  });

  // ---- service directory + readiness ----
  r.post('/services', requirePermission('referrals:update', audit), (req, res, next) => {
    try {
      const b = req.body || {};
      const name = str(b.name), county = str(b.county), subCounty = str(b.sub_county ?? b.subCounty);
      const type = str(b.type);
      if (!name || !county || !subCounty || !['Health', 'Police', 'NGO', 'Shelter'].includes(type)) {
        throw new HttpError(400, 'invalid_payload', 'name, county, sub_county, type (Health|Police|NGO|Shelter) required.');
      }
      const s = beyond.insertService({
        name, type, county, subCounty, verified: toBool(b.verified) || b.verified === undefined,
        open247: toBool(b.open_24_7), privateRoom: toBool(b.private_room),
        operatingHoursVerified: toBool(b.operating_hours_verified) || b.operating_hours_verified === undefined,
        staffingAdequate: ['Yes', 'Partial', 'No'].includes(str(b.staffing_adequate)) ? str(b.staffing_adequate) : 'Yes',
      });
      auditLog(req, 'service.create', s.id);
      res.status(201).json(s);
    } catch (e) { next(e); }
  });

  r.get('/services', requirePermission('services:read', audit), (req, res) => {
    res.json(beyond.listServices()); auditLog(req, 'service.list');
  });

  // Readiness = aggregate view of the service directory per county (no individual data).
  r.get('/readiness', requirePermission('readiness:read', audit), (req, res) => {
    const byCounty = {};
    for (const s of beyond.listServices()) {
      const c = (byCounty[s.county] ??= { county: s.county, services: 0, open_24_7: 0, private_room: 0, verified: 0 });
      c.services++; if (s.open_24_7) c.open_24_7++; if (s.private_room) c.private_room++; if (s.verified) c.verified++;
    }
    res.json(Object.values(byCounty));
  });

  // ---- referrals ----
  r.post('/referrals', requirePermission('referrals:create', audit), (req, res, next) => {
    try {
      const b = req.body || {};
      const coded = str(b.coded_record_id), to = str(b.to_service_id), county = str(b.county), category = str(b.category);
      if (!coded || !to || !county || !category) {
        throw new HttpError(400, 'invalid_payload', 'coded_record_id, to_service_id, county, category required.');
      }
      const status = str(b.status) || 'Initiated';
      if (!['Initiated', 'Completed', 'Not Completed', 'Not Documented'].includes(status)) {
        throw new HttpError(400, 'invalid_payload', 'Invalid referral status.');
      }
      const ref = beyond.insertReferral({
        codedRecordId: coded, fromServiceId: str(b.from_service_id) || null, toServiceId: to,
        county, category, status, statusNotes: str(b.status_notes) || null, createdBy: req.user.id,
      });
      auditLog(req, 'referral.create', ref.id);
      res.status(201).json(ref);
    } catch (e) { next(e); }
  });

  r.post('/referrals/:id/status', requirePermission('referrals:update', audit), (req, res, next) => {
    try {
      const ref = beyond.updateReferralStatus(req.params.id, str(req.body?.status), str(req.body?.status_notes) || null);
      if (!ref) throw new HttpError(404, 'not_found', 'Referral not found.');
      auditLog(req, 'referral.update', ref.id);
      res.json(ref);
    } catch (e) {
      if (e instanceof HttpError) return next(e);
      next(e?.message === 'invalid_referral_status'
        ? new HttpError(400, 'invalid_payload', 'Invalid referral status.')
        : e);
    }
  });

  r.get('/referrals', requirePermission('services:read', audit), (req, res) => {
    res.json(beyond.listReferrals()); auditLog(req, 'referral.list');
  });

  // ---- aggregate analytics (small-cell suppressed) ----
  r.get('/analytics/aggregate', requirePermission('analytics:aggregate:read', audit), (req, res) => {
    res.json(beyond.aggregate({ groupBy: str(req.query.group_by) || 'county', category: str(req.query.category) || null }));
  });

  // ---- retention lifecycle ----
  const RET_TABLES = { police: 'police_abstractions', odpp: 'odpp_court_abstractions', health: 'health_gbvrc_abstractions' };
  r.post('/retention/:tier/:id', requirePermission('retention:manage', audit), (req, res, next) => {
    try {
      const table = RET_TABLES[req.params.tier];
      if (!table) throw new HttpError(404, 'not_found', 'Unknown record tier.');
      const status = str(req.body?.status);
      beyond.setRetentionStatus(table, req.params.id, status);
      auditLog(req, `retention.${status}`, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      next(e?.message === 'invalid_retention_status'
        ? new HttpError(400, 'invalid_payload', 'status must be active|flagged_for_deletion|anonymized')
        : e?.message === 'not_found' ? new HttpError(404, 'not_found', 'Record not found.') : e);
    }
  });

  return r;
}
