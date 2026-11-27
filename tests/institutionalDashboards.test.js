import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { makeApp, loggedIn, PW } from './helpers.js';
import { ROLES, HOME_FOR_ROLE } from '../src/auth/roles.js';

const login = async (ctx, role, suffix = '') => {
  const { agent } = await loggedIn(ctx, 'u_' + role.slice(0, 8) + suffix, role);
  return agent;
};

describe('institutional partner RBAC (Police/DCI, Court/ODPP)', () => {
  it.each([ROLES.POLICE_FOCAL, ROLES.COURT_FOCAL])('%s is 403 on raw records and demographics endpoints', async (role) => {
    const ctx = makeApp();
    const agent = await login(ctx, role);
    for (const path of ['/api/records', '/api/analytics/aggregate', '/api/datasets/pi-restricted',
      '/api/audit', '/api/users', '/api/police', '/api/odpp', '/api/health',
      '/api/linkage/records', '/api/retention/police/x'])
      expect((await agent.get(path)).status).toBe(403);
    // POST surfaces are equally blocked
    expect((await agent.post('/api/ingest/police').send({ records: [] })).status).toBe(403);
    expect(ctx.repos.audit.list().some((a) => a.action.startsWith('denied:partner:'))).toBe(true);
  });

  it.each([ROLES.POLICE_FOCAL, ROLES.COURT_FOCAL])('%s can read its own institutional metrics', async (role) => {
    const ctx = makeApp();
    const agent = await login(ctx, role);
    const res = await agent.get('/api/institutional-metrics');
    expect(res.status).toBe(200);
    expect(res.body.mandate).toBe(role === ROLES.POLICE_FOCAL ? 'police' : 'court');
  });

  it.each([ROLES.PI, ROLES.DATA_MANAGER, ROLES.ENUMERATOR, ROLES.SYSTEM_ADMIN, ROLES.FOCAL_PERSON, ROLES.FIELD_SUPERVISOR])('%s is 403 on /api/institutional-metrics', async (role) => {
    const ctx = makeApp();
    const agent = await login(ctx, role);
    expect((await agent.get('/api/institutional-metrics')).status).toBe(403);
  });

  it('unauthenticated requests to institutional metrics get 401', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/institutional-metrics')).status).toBe(401);
  });

  it('mandate separation: police focal gets police data, never court; and vice versa', async () => {
    const ctx = makeApp();
    const police = await login(ctx, ROLES.POLICE_FOCAL, 'a');
    const court = await login(ctx, ROLES.COURT_FOCAL, 'b');

    const p = await police.get('/api/institutional-metrics');
    expect(p.body.mandate).toBe('police');
    expect(p.body.metrics).toHaveProperty('casesReported');
    expect(p.body.metrics).toHaveProperty('p3FormsIssued');
    expect(JSON.stringify(p.body)).not.toMatch(/mandate":"court/);

    const c = await court.get('/api/institutional-metrics');
    expect(c.body.mandate).toBe('court');
    expect(c.body.metrics).toHaveProperty('casesReceived');
    expect(c.body.metrics).toHaveProperty('convictionsSecured');
    expect(JSON.stringify(c.body)).not.toMatch(/mandate":"police/);
  });
});

describe('navigation & routing', () => {
  it('login home map sends each partner role to its own dashboard', () => {
    expect(HOME_FOR_ROLE[ROLES.POLICE_FOCAL]).toBe('/dashboard/police');
    expect(HOME_FOR_ROLE[ROLES.COURT_FOCAL]).toBe('/dashboard/court');
    expect(HOME_FOR_ROLE[ROLES.PI]).toBeUndefined(); // internal roles keep the default home
  });

  it('dashboard pages exist and ship no third-party URLs (CSP: self only)', () => {
    for (const f of ['public/dashboards/police.html', 'public/dashboards/court.html']) {
      const html = readFileSync(f, 'utf8');
      expect(html).toMatch(/Institutional Workspace/);
      expect(html).toMatch(/Restricted View/); // disclaimer banner present
      expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
    }
  });

  it('login page redirects partners to their dashboards after sign-in', () => {
    const html = readFileSync('public/app/login.html', 'utf8');
    expect(html).toMatch(/police_dci_focal_person:\s*['"]\/dashboard\/police/);
    expect(html).toMatch(/court_odpp_focal_person:\s*['"]\/dashboard\/court/);
  });

  it('sidebar filters nav links by role (partners see only their dashboard + reports)', () => {
    const js = readFileSync('public/app/js/shell.js', 'utf8');
    expect(js).toMatch(/dashboard-police/);
    expect(js).toMatch(/roles:\s*\['police_dci_focal_person'\]/);
    expect(js).toMatch(/isPartner/);
  });
});

describe('police dashboard payload (aggregate only)', () => {
  it('aggregates offences, P3, referrals and hides all identifiers', async () => {
    const ctx = makeApp();
    // seed a few police abstractions via the repository (as ingestion would)
    const seedUser = await ctx.authService.createUser({ username: 'seeduser', displayName: 'Seed', password: PW, role: ROLES.PI, mustChangePassword: false });
    for (let i = 0; i < 6; i++)
      ctx.repos.beyond.insertPoliceAbstraction({
        codedRef: `PGD-00${i}`, county: 'Mombasa',
        offenceCategory: i % 2 ? 'Rape' : 'Defilement', p3Issued: i % 2 ? 'Yes' : 'No',
        referralInitiated: 'Yes', recordPeriod: '2026-Q4', createdBy: seedUser.id
      });

    const agent = await login(ctx, ROLES.POLICE_FOCAL);
    const res = await agent.get('/api/institutional-metrics');
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.metrics.casesReported).toBe(6);
    expect(b.metrics.p3FormsIssued).toBe(3);
    expect(b.reportedOffenceCategories).toEqual(expect.arrayContaining([
      { category: 'Rape', cases: 3 }, { category: 'Defilement', cases: 3 }]));
    // no raw identifiers leak into the payload
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/coded_ref|PGD-00|victim|survivor/i);
    // referral pathways carry only the four permitted columns
    for (const row of b.recentReferralPathways) {
      expect(Object.keys(row).sort()).toEqual(['dateInitiated', 'destinationInstitution', 'referralId', 'status']);
      expect(row.status).toMatch(/^(Completed|Not Documented)$/);
    }
  });
});

describe('court dashboard payload (aggregate only)', () => {
  it('returns progression funnel, outcomes and backlog without case identifiers', async () => {
    const ctx = makeApp();
    const seedUser = await ctx.authService.createUser({ username: 'seeduser2', displayName: 'Seed', password: PW, role: ROLES.PI, mustChangePassword: false });
    for (let i = 0; i < 5; i++)
      ctx.repos.beyond.insertOdppAbstraction({
        codedRef: `OD-00${i}`, county: 'Mombasa',
        offenceCategory: 'Defilement', caseProgression: i < 3 ? 'Concluded' : 'Pending',
        trialOutcome: i < 2 ? 'Convicted' : '—', recordPeriod: '2026-Q4', createdBy: seedUser.id
      });

    const agent = await login(ctx, ROLES.COURT_FOCAL);
    const res = await agent.get('/api/institutional-metrics');
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.metrics.casesReceived).toBe(5);
    expect(b.metrics.convictionsSecured).toBe(2);
    expect(b.caseProgressionFunnel.map((s) => s.stage)).toEqual(['Reported', 'Charged', 'Filed', 'Concluded']);
    expect(b.caseOutcomes).toEqual(expect.arrayContaining([{ outcome: 'Convicted', cases: 2 }]));
    for (const row of b.caseBacklog) {
      expect(Object.keys(row).sort()).toEqual(['activeCases', 'averageTimeInSystemDays', 'category']);
    }
    expect(JSON.stringify(b)).not.toMatch(/coded_ref|OD-00/);
  });
});
