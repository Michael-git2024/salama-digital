// Bootstraps the first System Administrator. No default credentials exist anywhere.
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';

const config = loadConfig();
const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password } = process.env;
if (!username || !password) { console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD'); process.exit(1); }
const { authService } = createApp({ config, db: openDb(config.dbPath) });
await authService.createUser({ username: username.toLowerCase(), displayName: 'System Administrator', password, role: 'system_administrator', mustChangePassword: true });
console.log('Admin created. You must change the password and enrol MFA at first login.');
