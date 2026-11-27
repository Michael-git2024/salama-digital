-- Extend audit_log with endpoint and ip_address (never logging sensitive payloads)
ALTER TABLE audit_log ADD COLUMN endpoint TEXT;
ALTER TABLE audit_log ADD COLUMN ip_address TEXT;

-- De-identified Police Gender Desk abstractions
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

-- De-identified ODPP & Courts case progression abstractions
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

-- De-identified Health / GBVRC abstractions
CREATE TABLE health_gbvrc_abstractions (
  id TEXT PRIMARY KEY,
  coded_ref TEXT NOT NULL,
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

-- PI-issued authorization tokens for cross-institution linkage
CREATE TABLE linkage_authorizations (
  token TEXT PRIMARY KEY,
  issued_by TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

-- Cross-institution record links (blocked unless PI authorization_token is provided)
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

-- Mapped service directory (Health, Police, NGO, Shelter)
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Health', 'Police', 'NGO', 'Shelter')),
  county TEXT NOT NULL,
  sub_county TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1,
  open_24_7 INTEGER NOT NULL DEFAULT 0,
  private_room INTEGER NOT NULL DEFAULT 0,
  operating_hours_verified INTEGER NOT NULL DEFAULT 1,
  staffing_adequate TEXT NOT NULL DEFAULT 'Yes' CHECK (staffing_adequate IN ('Yes', 'Partial', 'No')),
  last_audited_at TEXT NOT NULL
);

-- Referrals strictly preserving 'Not Completed' vs 'Not Documented'
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

-- Analytical study records (used for aggregate queries & small-cell suppression)
CREATE TABLE research_records (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL UNIQUE,
  county TEXT NOT NULL,
  site_type TEXT NOT NULL,
  age_band TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT 'Female',
  category TEXT NOT NULL,
  referral_status TEXT NOT NULL CHECK (referral_status IN ('Initiated', 'Completed', 'Not Completed', 'Not Documented')),
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'flagged_for_deletion', 'anonymized')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_research_agg ON research_records(county, category, site_type, sex);
