// Single place for all configuration and secrets.
import 'dotenv/config';

const list = (v, d) => (v === undefined ? d : v.split(',').map((s) => s.trim()).filter(Boolean));
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(overrides = {}) {
  const env = process.env;
  const isTest = env.NODE_ENV === 'test';
  const cfg = {
    env: env.NODE_ENV || 'development',
    port: num(env.PORT, 3000),
    dbPath: env.DB_PATH || './data/salama.db',
    jwtSecret: env.JWT_SECRET || (isTest ? 'test-only-jwt-secret-test-only-jwt-secret' : ''),
    mfaEncKey: env.MFA_ENC_KEY || (isTest ? 'a'.repeat(64) : ''),
    sessionIdleMinutes: num(env.SESSION_IDLE_MINUTES, 30),
    sessionMaxHours: num(env.SESSION_MAX_HOURS, 8),
    maxFailedLogins: num(env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: num(env.LOCKOUT_MINUTES, 15),
    mfaRequiredRoles: list(env.MFA_REQUIRED_ROLES, ['system_administrator', 'principal_investigator', 'data_manager_analyst']),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    ...overrides,
  };
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) throw new Error('JWT_SECRET missing or shorter than 32 chars (see .env.example)');
  if (!/^[0-9a-f]{64}$/i.test(cfg.mfaEncKey)) throw new Error('MFA_ENC_KEY must be 64 hex chars (see .env.example)');
  return cfg;
}
