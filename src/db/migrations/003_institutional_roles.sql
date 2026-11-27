-- Institutional focal person roles for external partners (Police/DCI, Courts/ODPP).
-- These roles see ONLY aggregate/de-identified process metrics; they can never hold
-- permissions for raw records or survivor demographics.
-- SQLite cannot ALTER a CHECK constraint, so users is rebuilt. Sessions must be rebuilt
-- with it because its foreign key reference would otherwise be rewritten to users_old.
PRAGMA foreign_keys = OFF;
-- legacy_alter_table keeps REFERENCES users(id) in other tables pointing at the rebuilt
-- table (otherwise RENAME rewrites them to users_old, which is then dropped).
PRAGMA legacy_alter_table = ON;
ALTER TABLE users RENAME TO users_old;
ALTER TABLE sessions RENAME TO sessions_old;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'system_administrator','principal_investigator','field_supervisor',
    'research_enumerator','data_manager_analyst','institutional_focal_person',
    'police_dci_focal_person','court_odpp_focal_person','public_visitor')),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret_enc TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deactivated_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
INSERT INTO users (id, username, display_name, password_hash, role, is_active, must_change_password,
                   failed_logins, locked_until, mfa_enabled, mfa_secret_enc, created_at, updated_at, deactivated_at)
SELECT id, username, display_name, password_hash, role, is_active, must_change_password,
       failed_logins, locked_until, mfa_enabled, mfa_secret_enc, created_at, updated_at, deactivated_at
FROM users_old;
INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, revoked_at)
SELECT id, user_id, created_at, last_seen_at, expires_at, revoked_at FROM sessions_old;
DROP TABLE sessions_old;
DROP TABLE users_old;
DROP INDEX IF EXISTS idx_sessions_user;
CREATE INDEX idx_sessions_user ON sessions(user_id);
PRAGMA legacy_alter_table = OFF;

-- The 002 abstraction tables reference users(id); SQLite rewrote those references to
-- users_old during the rename. Rebuild them (MVP stage: existing rows are dev data).
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS record_links;
DROP TABLE IF EXISTS linkage_authorizations;
DROP TABLE IF EXISTS health_gbvrc_abstractions;
DROP TABLE IF EXISTS odpp_court_abstractions;
DROP TABLE IF EXISTS police_abstractions;
CREATE TABLE police_abstractions (
  id TEXT PRIMARY KEY,
  coded_ref TEXT NOT NULL,
  county TEXT NOT NULL,
  offence_category TEXT NOT NULL,
  p3_issued TEXT NOT NULL CHECK (p3_issued IN ('Yes', 'No')),
  referral_initiated TEXT NOT NULL CHECK (referral_initiated IN ('Yes', 'No')),
  record_period TEXT NOT NULL,
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'flagged_for_deletion', 'anonymized')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE odpp_court_abstractions (
  id TEXT PRIMARY KEY,
  coded_ref TEXT NOT NULL,
  county TEXT NOT NULL,
  offence_category TEXT NOT NULL,
  case_progression TEXT NOT NULL CHECK (case_progression IN ('Filed', 'Pending', 'Concluded')),
  trial_outcome TEXT NOT NULL,
  record_period TEXT NOT NULL,
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'flagged_for_deletion', 'anonymized')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE health_gbvrc_abstractions (
  id TEXT PRIMARY KEY,
  county TEXT NOT NULL,
  site_type TEXT NOT NULL DEFAULT 'Urban',
  age_band TEXT NOT NULL DEFAULT '18-24',
  sex TEXT NOT NULL DEFAULT 'Female',
  category TEXT NOT NULL,
  attendance_count INTEGER NOT NULL DEFAULT 1,
  clinical_referral TEXT NOT NULL CHECK (clinical_referral IN ('Yes', 'No')),
  service_utilization TEXT NOT NULL,
  record_period TEXT NOT NULL,
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'flagged_for_deletion', 'anonymized')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE linkage_authorizations (
  token TEXT PRIMARY KEY,
  issued_by TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE record_links (
  id TEXT PRIMARY KEY,
  source_institution TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  target_institution TEXT NOT NULL,
  target_record_id TEXT NOT NULL,
  authorization_token TEXT NOT NULL REFERENCES linkage_authorizations(token),
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE referrals (
  id TEXT PRIMARY KEY,
  coded_record_id TEXT NOT NULL,
  from_service_id TEXT REFERENCES services(id),
  to_service_id TEXT NOT NULL REFERENCES services(id),
  county TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Initiated' CHECK (status IN ('Initiated', 'Completed', 'Not Completed', 'Not Documented')),
  status_notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
PRAGMA foreign_keys = ON;
