import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { makeApp } from './helpers.js';

describe('public vs secure separation', () => {
  it('internal routes are noindex + no-store; robots.txt disallows them', async () => {
    const { app } = makeApp();
    for (const p of ['/api/auth/me', '/app/']) {
      const r = await request(app).get(p);
      expect(r.headers['x-robots-tag']).toMatch(/noindex/);
      expect(r.headers['cache-control']).toMatch(/no-store/);
    }
    const robots = (await request(app).get('/robots.txt')).text;
    expect(robots).toMatch(/Disallow: \/app/); expect(robots).toMatch(/Disallow: \/api/);
  });
  it('public home page is served and has no workspace data', async () => {
    const r = await request(makeApp().app).get('/');
    expect(r.status).toBe(200); expect(r.text).toContain('Beyond Reporting');
  });
  it('CSP forbids third-party scripts/connections', async () => {
    const csp = (await request(makeApp().app).get('/')).headers['content-security-policy'];
    expect(csp).toMatch(/script-src 'self'/); expect(csp).toMatch(/connect-src 'self'/);
  });
  it('front-end ships no third-party URLs', () => {
    for (const f of ['public/index.html', 'public/app/index.html', 'public/js/app.js', 'public/css/theme.css'])
      expect(readFileSync(f, 'utf8')).not.toMatch(/https?:\/\/(?!localhost)/);
  });
});
