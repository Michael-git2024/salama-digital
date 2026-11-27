// Exactly 9 roles. Public Visitor is the implicit role of unauthenticated requests; it cannot hold an account.
// Police/DCI and Court/ODPP focal persons are EXTERNAL partners: they only see aggregate,
// de-identified process metrics — never raw records or survivor demographics.
export const ROLES = Object.freeze({
  SYSTEM_ADMIN: 'system_administrator',
  PI: 'principal_investigator',
  FIELD_SUPERVISOR: 'field_supervisor',
  ENUMERATOR: 'research_enumerator',
  DATA_MANAGER: 'data_manager_analyst',
  FOCAL_PERSON: 'institutional_focal_person',
  POLICE_FOCAL: 'police_dci_focal_person',
  COURT_FOCAL: 'court_odpp_focal_person',
  PUBLIC: 'public_visitor',
});
export const ALL_ROLES = Object.values(ROLES);
export const ACCOUNT_ROLES = ALL_ROLES.filter((r) => r !== ROLES.PUBLIC);
export const INSTITUTIONAL_PARTNER_ROLES = Object.freeze([ROLES.POLICE_FOCAL, ROLES.COURT_FOCAL]);

const R = ROLES;
// Least privilege. System Administrator manages accounts/audit but has NO research-data access (separation of duties).
export const PERMISSIONS = Object.freeze({
  'users:manage': [R.SYSTEM_ADMIN],
  'audit:read': [R.SYSTEM_ADMIN, R.PI],
  'datasets:pi:read': [R.PI, R.DATA_MANAGER],
  'instruments:read': [R.PI, R.FIELD_SUPERVISOR, R.ENUMERATOR, R.DATA_MANAGER],
  'instruments:manage': [R.PI],
  'fieldwork:view': [R.PI, R.FIELD_SUPERVISOR, R.ENUMERATOR],
  'fieldwork:assign': [R.PI, R.FIELD_SUPERVISOR],
  'survey:submit': [R.ENUMERATOR],
  'analytics:aggregate:read': [R.PI, R.FIELD_SUPERVISOR, R.DATA_MANAGER, R.FOCAL_PERSON],
  'exports:create': [R.PI, R.DATA_MANAGER],
  // Beyond Reporting institutional ingestion, linkage, referrals, readiness, retention
  'ingest:police': [R.PI, R.DATA_MANAGER],
  'ingest:odpp': [R.PI, R.DATA_MANAGER],
  'ingest:health': [R.PI, R.DATA_MANAGER],
  'linkage:authorize': [R.PI],
  'records:link': [R.PI, R.DATA_MANAGER],
  'services:read': [R.PI, R.FIELD_SUPERVISOR, R.ENUMERATOR, R.DATA_MANAGER, R.FOCAL_PERSON],
  'referrals:create': [R.PI, R.FIELD_SUPERVISOR, R.ENUMERATOR, R.DATA_MANAGER, R.FOCAL_PERSON],
  'referrals:update': [R.PI, R.FIELD_SUPERVISOR, R.DATA_MANAGER, R.FOCAL_PERSON],
  'readiness:read': [R.PI, R.FIELD_SUPERVISOR, R.DATA_MANAGER, R.FOCAL_PERSON],
  'retention:manage': [R.SYSTEM_ADMIN, R.PI, R.DATA_MANAGER],
  // External partner focal persons: strictly aggregate process metrics for their mandate only.
  'metrics:police': [R.POLICE_FOCAL],
  'metrics:court': [R.COURT_FOCAL],
  'metrics:read': [R.POLICE_FOCAL, R.COURT_FOCAL],
});

// Raw/individual-level data endpoints that institutional partners must NEVER reach (403 by design).
// Paths are relative to the /api mount (the blocker middleware runs inside app.use('/api')).
export const FORBIDDEN_PARTNER_PATHS = Object.freeze(['/records', '/analytics/aggregate', '/datasets/pi-restricted', '/audit', '/users', '/ingest', '/linkage', '/retention', '/police', '/odpp', '/health', '/referrals']);

export const HOME_FOR_ROLE = Object.freeze({
  [ROLES.POLICE_FOCAL]: '/dashboard/police',
  [ROLES.COURT_FOCAL]: '/dashboard/court',
});

export const can = (role, perm) => (PERMISSIONS[perm] || []).includes(role);
export const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));
