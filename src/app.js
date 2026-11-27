import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserRepository } from './repositories/userRepository.js';
import { createSessionRepository } from './repositories/sessionRepository.js';
import { createAuditRepository } from './repositories/auditRepository.js';
import { createDatasetRepository } from './repositories/datasetRepository.js';
import { createBeyondReportingRepository } from './repositories/beyondReportingRepository.js';
import { createAuthService } from './services/authService.js';
import { attachUser, blockInstitutionalPartners } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { researchRoutes } from './routes/research.js';
import { beyondReportingRoutes } from './routes/beyondReporting.js';
import { institutionalMetricsRoutes } from './routes/institutionalMetrics.js';
import { HttpError } from './lib/errors.js';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ config, db }) {
  const users = createUserRepository(db);
  const sessions = createSessionRepository(db);
  const audit = createAuditRepository(db);
  const datasets = createDatasetRepository(db);
  const beyond = createBeyondReportingRepository(db);
  const authService = createAuthService({ config, users, sessions, audit });

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"] } } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Internal surface is never indexed or cached. No third-party scripts anywhere (CSP above).
  app.use(['/api', '/app'], (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /app\nDisallow: /api\n'));
  // Liveness/readiness probe for hosting platforms (Render/Render health checks, uptime monitors).
  // Reports process + DB status only; carries no data and requires no auth.
  app.get('/healthz', (_req, res) => {
    let dbStatus = 'ok';
    try { db.prepare('SELECT 1 AS x').get(); } catch { dbStatus = 'unavailable'; }
    res.status(dbStatus === 'ok' ? 200 : 503).json({ status: dbStatus === 'ok' ? 'ok' : 'degraded', db: dbStatus, ts: new Date().toISOString() });
  });

  // CSRF defence in depth: SameSite=Strict cookie + JSON-only state-changing requests.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) return next(new HttpError(415, 'json_required', 'JSON body required.'));
    next();
  });

  app.use('/api', attachUser(authService));
  app.use('/api', blockInstitutionalPartners(audit));
  app.use('/api/auth', authRoutes({ config, authService }));
  app.use('/api/users', userRoutes({ authService, users, audit }));
  app.use('/api', researchRoutes({ datasets, audit }));
  app.use('/api', beyondReportingRoutes({ beyond, audit }));
  app.use('/api', institutionalMetricsRoutes({ beyond, audit }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found.')));

  app.use(express.static(pub)); // public site at /, secure workspace shell at /app/ (data only via the API)
  app.use(express.static(join(pub, 'dashboards'), { index: false })); // /dashboard/* static pages

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error('Unhandled error:', err.name, err.message); // name only - never log request content
    res.status(500).json({ error: 'server_error' });
  });

  return { app, repos: { users, sessions, audit, datasets, beyond }, authService };
}
