import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { makeApp, addUser, loggedIn, PW } from './helpers.js';
import { ROLES } from '../src/auth/roles.js';
import { decryptField } from '../src/lib/crypto.js';

describe('login & sessions', () => {
  it('logs in, sets httpOnly SameSite=Strict cookie, and never returns the password hash', async () => {
    const ctx = makeApp();
    const { res } = await loggedIn(ctx, 'enum1', ROLES.ENUMERATOR);
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|\$2/);
  });
  it('wrong password and unknown user give the same response', async () => {
    const ctx = makeApp(); await addUser(ctx, 'enum1', ROLES.ENUMERATOR);
    const a = await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: 'nope-nope-nope1' });
    const b = await request(ctx.app).post('/api/auth/login').send({ username: 'ghost', password: 'nope-nope-nope1' });
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body).toEqual(b.body);
  });
  it('locks the account after repeated failures, even for the right password', async () => {
    const ctx = makeApp({ maxFailedLogins: 3 }); await addUser(ctx, 'enum1', ROLES.ENUMERATOR);
    for (let i = 0; i < 3; i++) await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: 'bad-bad-bad-1' });
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: PW })).status).toBe(429);
  });
  it('logout revokes the session server-side', async () => {
    const ctx = makeApp(); const { agent } = await loggedIn(ctx, 'enum1', ROLES.ENUMERATOR);
    const token = (await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: PW })).headers['set-cookie'][0].split(';')[0].split('=')[1];
    await agent.post('/api/auth/logout').send({});
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200); // other session unaffected
  });
  it('idle sessions expire', async () => {
    const ctx = makeApp(); const { agent } = await loggedIn(ctx, 'enum1', ROLES.ENUMERATOR);
    ctx.db.prepare("UPDATE sessions SET last_seen_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
  it('deactivation kills live sessions and blocks login; reactivation restores', async () => {
    const ctx = makeApp();
    const { agent } = await loggedIn(ctx, 'enum1', ROLES.ENUMERATOR);
    const { agent: admin } = await loggedIn(ctx, 'admin1', ROLES.SYSTEM_ADMIN);
    const id = ctx.repos.users.findByUsername('enum1').id;
    expect((await admin.post(`/api/users/${id}/deactivate`).send({})).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: PW })).status).toBe(401);
    await admin.post(`/api/users/${id}/reactivate`).send({});
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: PW })).status).toBe(200);
  });
  it('admin cannot deactivate themselves', async () => {
    const ctx = makeApp(); const { agent } = await loggedIn(ctx, 'admin1', ROLES.SYSTEM_ADMIN);
    expect((await agent.post(`/api/users/${ctx.repos.users.findByUsername('admin1').id}/deactivate`).send({})).status).toBe(400);
  });
  it('temporary passwords must be changed before any other API use', async () => {
    const ctx = makeApp(); const { agent } = await loggedIn(ctx, 'pi1', ROLES.PI, { mustChangePassword: true });
    expect((await agent.get('/api/datasets/pi-restricted')).body.error).toBe('password_change_required');
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'Brand-New-Pass-42' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401); // sessions revoked
  });
});

describe('MFA', () => {
  it('required roles are blocked at the API until enrolled; then TOTP is demanded at login', async () => {
    const ctx = makeApp({ mfaRequiredRoles: [ROLES.PI] });
    const { agent } = await loggedIn(ctx, 'pi1', ROLES.PI);
    expect((await agent.get('/api/datasets/pi-restricted')).body.error).toBe('mfa_enrollment_required');
    const { secret } = (await agent.post('/api/auth/mfa/enroll').send({})).body;
    expect((await agent.post('/api/auth/mfa/confirm').send({ code: '000000' })).status).toBe(400);
    expect((await agent.post('/api/auth/mfa/confirm').send({ code: authenticator.generate(secret) })).status).toBe(200);
    expect((await agent.get('/api/datasets/pi-restricted')).status).toBe(200);

    const bare = await request(ctx.app).post('/api/auth/login').send({ username: 'pi1', password: PW });
    expect(bare.status).toBe(401); expect(bare.body.error).toBe('mfa_required');
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'pi1', password: PW, totp: '123456' })).status).toBe(401);
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'pi1', password: PW, totp: authenticator.generate(secret) })).status).toBe(200);
  });
  it('MFA secret is encrypted at rest', async () => {
    const ctx = makeApp(); const { agent } = await loggedIn(ctx, 'pi1', ROLES.PI);
    const { secret } = (await agent.post('/api/auth/mfa/enroll').send({})).body;
    const stored = ctx.repos.users.findByUsername('pi1').mfa_secret_enc;
    expect(stored).not.toContain(secret);
    expect(decryptField(stored, ctx.config.mfaEncKey)).toBe(secret);
  });
});

describe('audit log hygiene', () => {
  it('never contains passwords, tokens or TOTP codes', async () => {
    const ctx = makeApp(); await loggedIn(ctx, 'enum1', ROLES.ENUMERATOR);
    await request(ctx.app).post('/api/auth/login').send({ username: 'enum1', password: 'Secret-Wrong-77', totp: '654321' });
    const dump = JSON.stringify(ctx.repos.audit.list());
    for (const s of [PW, 'Secret-Wrong-77', '654321', 'eyJ']) expect(dump).not.toContain(s);
  });
});
