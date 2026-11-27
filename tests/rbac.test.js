import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, addUser, loggedIn, PW } from './helpers.js';
import { ALL_ROLES, ACCOUNT_ROLES, PERMISSIONS, can, ROLES } from '../src/auth/roles.js';

describe('role model', () => {
  it('defines exactly 9 roles including the two institutional partner roles', () => {
    expect(ALL_ROLES).toHaveLength(9);
    expect(ALL_ROLES).toContain('public_visitor');
    expect(ALL_ROLES).toContain('police_dci_focal_person');
    expect(ALL_ROLES).toContain('court_odpp_focal_person');
  });
  it('database rejects roles outside the 9', () => {
    const ctx = makeApp();
    expect(() => ctx.db.prepare("INSERT INTO users (id,username,display_name,password_hash,role,created_at,updated_at) VALUES ('x','x','x','x','superuser','t','t')").run()).toThrow();
  });
  it('public visitor cannot hold an account', async () => {
    const ctx = makeApp();
    await expect(addUser(ctx, 'visitor1', ROLES.PUBLIC)).rejects.toMatchObject({ status: 400 });
  });
  it('enumerators hold no analysis/PI/export/admin permissions; sysadmin has no research data access', () => {
    for (const p of ['datasets:pi:read', 'exports:create', 'users:manage', 'audit:read', 'analytics:aggregate:read'])
      expect(can(ROLES.ENUMERATOR, p)).toBe(false);
    expect(can(ROLES.SYSTEM_ADMIN, 'datasets:pi:read')).toBe(false);
  });
  it('institutional partner roles hold ONLY their metrics permission', () => {
    for (const role of [ROLES.POLICE_FOCAL, ROLES.COURT_FOCAL]) {
      expect(can(role, 'metrics:read')).toBe(true);
      for (const p of ['datasets:pi:read', 'users:manage', 'audit:read', 'analytics:aggregate:read',
                       'ingest:police', 'ingest:odpp', 'ingest:health', 'linkage:authorize', 'records:link',
                       'services:read', 'referrals:create', 'referrals:update', 'readiness:read', 'retention:manage'])
        expect(can(role, p)).toBe(false);
    }
    expect(can(ROLES.POLICE_FOCAL, 'metrics:court')).toBe(false); // mandate separation
    expect(can(ROLES.COURT_FOCAL, 'metrics:police')).toBe(false);
  });
  it('every permission references only valid roles', () => {
    for (const roles of Object.values(PERMISSIONS)) roles.forEach((r) => expect(ALL_ROLES).toContain(r));
  });
});

describe('API-layer authorisation (test 1: API blocks unauthorised roles)', () => {
  it('unauthenticated visitors get 401 on every workspace endpoint', async () => {
    const { app } = makeApp();
    for (const path of ['/api/datasets/pi-restricted', '/api/users', '/api/audit', '/api/auth/me'])
      expect((await request(app).get(path)).status).toBe(401);
  });
  it('Enumerator is denied the PI dataset (403) and the denial is audited', async () => {
    const ctx = makeApp();
    ctx.repos.datasets.create({ id: 'd1', code: 'PI-001', title: 'PI interviews', tier: 'pi_restricted' });
    const { agent } = await loggedIn(ctx, 'enum1', ROLES.ENUMERATOR);
    const res = await agent.get('/api/datasets/pi-restricted');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('PI-001');
    expect(ctx.repos.audit.list().some((a) => a.action === 'denied:datasets:pi:read' && a.outcome === 'denied')).toBe(true);
  });
  it.each([ROLES.FIELD_SUPERVISOR, ROLES.FOCAL_PERSON, ROLES.SYSTEM_ADMIN])('%s is denied the PI dataset', async (role) => {
    const ctx = makeApp();
    const { agent } = await loggedIn(ctx, 'u_' + role.slice(0, 8), role);
    expect((await agent.get('/api/datasets/pi-restricted')).status).toBe(403);
  });
  it.each([ROLES.PI, ROLES.DATA_MANAGER])('%s can read PI dataset (real rows)', async (role) => {
    const ctx = makeApp();
    ctx.repos.datasets.create({ id: 'd1', code: 'PI-001', title: 'PI interviews', tier: 'pi_restricted' });
    const { agent } = await loggedIn(ctx, 'u_' + role.slice(0, 8), role);
    const res = await agent.get('/api/datasets/pi-restricted');
    expect(res.status).toBe(200);
    expect(res.body.map((d) => d.code)).toEqual(['PI-001']);
  });
  it('non-admins cannot manage users; admin can create but cannot assign public_visitor', async () => {
    const ctx = makeApp();
    const { agent: e } = await loggedIn(ctx, 'enum2', ROLES.ENUMERATOR);
    expect((await e.post('/api/users').send({ username: 'evil', displayName: 'x', role: ROLES.PI, temporaryPassword: PW })).status).toBe(403);
    const { agent: a } = await loggedIn(ctx, 'admin1', ROLES.SYSTEM_ADMIN);
    expect((await a.post('/api/users').send({ username: 'newpi', displayName: 'New PI', role: ROLES.PI, temporaryPassword: PW })).status).toBe(201);
    expect((await a.post('/api/users').send({ username: 'vis', displayName: 'V', role: ROLES.PUBLIC, temporaryPassword: PW })).status).toBe(400);
  });
  it('rejects forged tokens and tokens in the URL', async () => {
    const ctx = makeApp();
    const { agent } = await loggedIn(ctx, 'pi1', ROLES.PI);
    expect((await request(ctx.app).get('/api/datasets/pi-restricted').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pi1', password: PW });
    const token = login.headers['set-cookie'][0].split(';')[0].split('=')[1];
    expect((await request(ctx.app).get(`/api/datasets/pi-restricted?token=${token}`)).status).toBe(401);
    expect(agent).toBeTruthy();
  });
  it('requires JSON for state-changing requests (CSRF defence)', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/auth/login').type('form').send('username=a&password=b')).status).toBe(415);
  });
});
