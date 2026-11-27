import request from 'supertest';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const PW = 'Correct-Horse-9';
export function makeApp(over = {}) {
  const config = loadConfig({ mfaRequiredRoles: [], bcryptCost: 4, ...over });
  const db = openDb(':memory:');
  const ctx = createApp({ config, db });
  return { ...ctx, db, config };
}
export async function addUser(ctx, username, role, extra = {}) {
  return ctx.authService.createUser({ username, displayName: username, password: PW, role, mustChangePassword: false, ...extra });
}
export async function loggedIn(ctx, username, role, extra) {
  await addUser(ctx, username, role, extra);
  const agent = request.agent(ctx.app);
  const res = await agent.post('/api/auth/login').send({ username, password: PW, ...(extra?.totp ? { totp: extra.totp } : {}) });
  return { agent, res };
}
