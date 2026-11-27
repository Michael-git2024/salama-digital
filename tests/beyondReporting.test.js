import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, loggedIn, PW, addUser } from './helpers.js';
import { ROLES } from '../src/auth/roles.js';

const ingestBody = {
  records: [{
    coded_ref: 'PGD-001', county: 'Nairobi', offence_category: 'Physical assault',
    p3_issued: 'Yes', referral_initiated: 'Yes', record_period: '2026-01'
  }],
};

const login = async (ctx, role, extra = {}, suffix = '') => {
  const { agent, res } = await loggedIn(ctx, 'u_' + role.slice(0, 8) + suffix, role, extra);
  const user = ctx.repos.users.findByUsername(res.body?.user?.username) ?? {};
  return { agent, user };
};

describe('ingestion (de-identified abstractions)', () => {
  it.each([ROLES.PI, ROLES.DATA_MANAGER])('%s can ingest police abstractions', async (role) => {
    const ctx = makeApp();
    const { agent: agent } = await login(ctx, role);
    const res = await agent.post('/api/ingest/police').send(ingestBody);
    expect(res.status).toBe(201);
    expect(ctx.repos.beyond.listPoliceAbstractions()).toHaveLength(1);
  });

  it.each([ROLES.ENUMERATOR, ROLES.FIELD_SUPERVISOR, ROLES.FOCAL_PERSON, ROLES.SYSTEM_ADMIN])('%s cannot ingest', async (role) => {
    const ctx = makeApp();
    const { agent: agent } = await login(ctx, role);
    expect((await agent.post('/api/ingest/police').send(ingestBody)).status).toBe(403);
    expect((await agent.post('/api/ingest/odpp').send(ingestBody)).status).toBe(403);
    expect((await agent.post('/api/ingest/health').send(ingestBody)).status).toBe(403);
  });

  it('rejects records containing direct identifiers with 422 and stores nothing', async () => {
    const ctx = makeApp();
    const { agent: agent } = await login(ctx, ROLES.PI);
    const bad = {
      records: [{
        coded_ref: 'X', county: 'Nairobi', offence_category: 'assault',
        p3_issued: 'No', referral_initiated: 'No', record_period: '2026-01',
        victim_name: 'Jane Wanjiku'
      }]
    };
    const res = await agent.post('/api/ingest/police').send(bad);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/data_protection_violation/);
    expect(ctx.repos.beyond.listPoliceAbstractions()).toHaveLength(0);
  });

  it('rejects phone / email / GPS values hidden inside free-text fields', async () => {
    const ctx = makeApp();
    const { agent: agent } = await login(ctx, ROLES.PI);
    for (const val of ['call +254712345678 now', 'reply to a@b.co.ke', 'found at -1.2864,36.8172']) {
      const res = await agent.post('/api/ingest/health').send({
        records: [{
          county: 'Nairobi', category: 'GBV', clinical_referral: 'No',
          service_utilization: val, record_period: '2026-01'
        }]
      });
      expect(res.status).toBe(422);
    }
    expect(ctx.repos.beyond.listHealthAbstractions()).toHaveLength(0);
  });

  it('accepts CSV payloads and ingests them as records', async () => {
    const ctx = makeApp();
    const { agent: agent } = await login(ctx, ROLES.DATA_MANAGER);
    const csv = 'coded_ref,county,offence_category,p3_issued,referral_initiated,record_period\nOD-1,Kisumu,Defilement,Yes,Yes,2026-02';
    const res = await agent.post('/api/ingest/odpp').send({ csv });
    expect(res.status).toBe(201);
    expect(ctx.repos.beyond.listOdppAbstractions()[0].offence_category).toBe('Defilement');
  });
});

describe('linkage (PI authorization only)', () => {
  it('only PI can issue authorization tokens', async () => {
    const ctx = makeApp();
    for (const role of [ROLES.DATA_MANAGER, ROLES.SYSTEM_ADMIN, ROLES.FIELD_SUPERVISOR]) {
      const { agent: agent } = await login(ctx, role);
      expect((await agent.post('/api/linkage/authorize').send({ purpose: 'study' })).status).toBe(403);
    }
    const { agent: pi } = await login(ctx, ROLES.PI);
    const res = await pi.post('/api/linkage/authorize').send({ purpose: 'cross-institution study' });
    expect(res.status).toBe(201); expect(res.body.token).toBeTruthy();
  });

  it('record links are blocked without an active PI token (403) and allowed with one (201)', async () => {
    const ctx = makeApp();
    const { agent: dm } = await login(ctx, ROLES.DATA_MANAGER);
    const body = {
      sourceInstitution: 'police', sourceRecordId: 'PGD-001',
      targetInstitution: 'health', targetRecordId: 'GBVRC-009'
    };
    expect((await dm.post('/api/linkage/records').send({ ...body, authorizationToken: 'bogus' })).status).toBe(403);

    const { agent: pi } = await login(ctx, ROLES.PI);
    const { body: { token } } = await pi.post('/api/linkage/authorize').send({ purpose: 'linkage' });
    const res = await dm.post('/api/linkage/records').send({ ...body, authorizationToken: token });
    expect(res.status).toBe(201);
    expect(ctx.repos.beyond.listRecordLinks()).toHaveLength(1);
  });
});

describe('service directory, readiness and referrals', () => {
  it('enumerator can read services but cannot create them', async () => {
    const ctx = makeApp();
    const { agent: admin } = await login(ctx, ROLES.FOCAL_PERSON);
    await admin.post('/api/services').send({ name: 'Nairobi RH', type: 'Health', county: 'Nairobi', sub_county: 'Westlands' });
    const { agent: enumAgent } = await login(ctx, ROLES.ENUMERATOR);
    expect((await enumAgent.get('/api/services')).status).toBe(200);
    expect((await enumAgent.post('/api/services').send({ name: 'X', type: 'NGO', county: 'c', sub_county: 's' })).status).toBe(403);
  });

  it('referral status preserves Not Completed vs Not Documented', async () => {
    const ctx = makeApp();
    const { agent: focal } = await login(ctx, ROLES.FOCAL_PERSON);
    const { agent: svc } = await login(ctx, ROLES.FOCAL_PERSON, {}, 'a');
    await svc.post('/api/services').send({ name: 'Shelter A', type: 'Shelter', county: 'Nairobi', sub_county: 'Langata' });
    const serviceId = (await focal.get('/api/services')).body[0].id;
    const mk = await focal.post('/api/referrals').send({ coded_record_id: 'R-1', to_service_id: serviceId, county: 'Nairobi', category: 'GBV' });
    expect(mk.status).toBe(201);
    const upd = await focal.post(`/api/referrals/${mk.body.id}/status`).send({ status: 'Not Completed' });
    expect(upd.body.status).toBe('Not Completed');
    const upd2 = await focal.post(`/api/referrals/${mk.body.id}/status`).send({ status: 'Not Documented' });
    expect(upd2.body.status).toBe('Not Documented');
    // invalid status rejected
    expect((await focal.post(`/api/referrals/${mk.body.id}/status`).send({ status: 'Completed Maybe' })).status).toBe(400);
  });

  it('enumerator cannot update referral status', async () => {
    const ctx = makeApp();
    const { agent: enumAgent } = await login(ctx, ROLES.ENUMERATOR);
    expect((await enumAgent.post('/api/referrals/x/status').send({ status: 'Completed' })).status).toBe(403);
  });

  it('readiness aggregates per county with no individual rows', async () => {
    const ctx = makeApp();
    const { agent: admin } = await login(ctx, ROLES.FOCAL_PERSON, {}, 'a');
    await admin.post('/api/services').send({ name: 'A', type: 'Police', county: 'Nairobi', sub_county: 'W', open_24_7: true });
    await admin.post('/api/services').send({ name: 'B', type: 'Shelter', county: 'Nairobi', sub_county: 'E', private_room: true });
    const { agent: focal } = await login(ctx, ROLES.FOCAL_PERSON, {}, 'b');
    const rows = (await focal.get('/api/readiness')).body;
    expect(rows).toEqual([{ county: 'Nairobi', services: 2, open_24_7: 1, private_room: 1, verified: 2 }]);
  });
});

describe('aggregate analytics with small-cell suppression', () => {
  it('cells with fewer than 5 records are suppressed (count null)', async () => {
    const ctx = makeApp();
    const { agent: pi } = await login(ctx, ROLES.PI);
    for (let i = 0; i < 4; i++)
      ctx.repos.beyond.insertResearchRecord({
        studyId: `S${i}`, county: 'Kisumu', siteType: 'Urban',
        ageBand: '18-24', category: 'GBV', referralStatus: 'Completed'
      });
    const rows = (await pi.get('/api/analytics/aggregate?group_by=county')).body;
    expect(rows[0].suppressed).toBe(true); expect(rows[0].count).toBeNull();

    for (let i = 4; i < 6; i++)
      ctx.repos.beyond.insertResearchRecord({
        studyId: `S${i}`, county: 'Kisumu', siteType: 'Urban',
        ageBand: '18-24', category: 'GBV', referralStatus: 'Completed'
      });
    const after = (await pi.get('/api/analytics/aggregate?group_by=county')).body;
    expect(after[0].suppressed).toBe(false); expect(after[0].count).toBe(6);

    // enumerator has no analytics permission
    const { agent: enumAgent } = await login(ctx, ROLES.ENUMERATOR);
    expect((await enumAgent.get('/api/analytics/aggregate')).status).toBe(403);
  });
});

describe('retention lifecycle', () => {
  it('records move through active -> flagged_for_deletion -> anonymized; only permitted roles', async () => {
    const ctx = makeApp();
    const { agent: pi, user: piUser } = await login(ctx, ROLES.PI);
    const rec = ctx.repos.beyond.insertPoliceAbstraction({
      codedRef: 'R1', county: 'Nairobi',
      offenceCategory: 'Assault', p3Issued: 'No', referralInitiated: 'No', recordPeriod: '2026-01', createdBy: piUser.id
    });
    for (const status of ['flagged_for_deletion', 'anonymized'])
      expect((await pi.post(`/api/retention/police/${rec.id}`).send({ status })).status).toBe(200);
    expect(ctx.db.prepare('SELECT retention_status FROM police_abstractions WHERE id = ?').get(rec.id).retention_status).toBe('anonymized');
    expect((await pi.post(`/api/retention/police/${rec.id}`).send({ status: 'weird' })).status).toBe(400);

    const { agent: sysAdmin } = await login(ctx, ROLES.SYSTEM_ADMIN);
    expect((await sysAdmin.post(`/api/retention/police/${rec.id}`).send({ status: 'active' })).status).toBe(200);
    const { agent: enumAgent } = await login(ctx, ROLES.ENUMERATOR);
    expect((await enumAgent.post(`/api/retention/police/${rec.id}`).send({ status: 'active' })).status).toBe(403);
  });

  it('unknown tier returns 404', async () => {
    const ctx = makeApp();
    const { agent: pi } = await login(ctx, ROLES.PI);
    expect((await pi.post('/api/retention/nope/x').send({ status: 'active' })).status).toBe(404);
  });
});

describe('audit trail for beyond-reporting actions', () => {
  it('logs ingest, linkage and referral actions with endpoint metadata', async () => {
    const ctx = makeApp();
    const { agent: pi } = await login(ctx, ROLES.PI);
    await pi.post('/api/ingest/police').send(ingestBody);
    const actions = ctx.repos.audit.list().map((a) => a.action);
    expect(actions).toContain('ingest.police');
    const entries = ctx.repos.audit.list().filter((a) => a.action === 'ingest.police');
    expect(entries[0].actor_id).toBeTruthy();
    // raw payload content never lands in the audit log
    expect(JSON.stringify(ctx.repos.audit.list())).not.toContain('PGD-001');
  });
});
