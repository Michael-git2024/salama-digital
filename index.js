const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'default_secret_key_that_is_at_least_32_characters_long_for_local_testing';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('WARNING: Set JWT_SECRET to a random secret of at least 32 characters before public hosting.');
}

// Setup Database
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
const db = new Database(path.join(dbDir, 'database.db'));

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

// Audit function
function audit(email, action, details = '') {
  try {
    db.prepare('INSERT INTO audit_log (email, action, details) VALUES (?, ?, ?)').run(email, action, details);
  } catch (e) {
    console.error('Audit failed', e);
  }
}

// Auth Middleware
function auth(req, res, next) {
  const token = req.cookies.salama_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { 
    req.user = jwt.verify(token, SECRET); 
    next(); 
  } catch { 
    res.clearCookie('salama_token'); 
    return res.status(401).json({ error: 'Session expired' }); 
  }
}

function role(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' });
}

// Routes
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Salama Digital', mode: 'MVP', note: 'Use synthetic or approved non-sensitive data only.' }));

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); 
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, SECRET, { expiresIn: '6h' });
  res.cookie('salama_token', token, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict', maxAge: 6 * 60 * 60 * 1000 });
  audit(email, 'login'); 
  res.json({ user: { email: u.email, role: u.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('salama_token', { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true' });
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/users', auth, role('administrator'), (req, res) => {
  const b = req.body || {}; 
  const email = String(b.email || '').trim().toLowerCase(); 
  const password = String(b.password || ''); 
  const allowed = ['administrator', 'principal_investigator', 'data_manager'];
  if (!email.includes('@') || password.length < 12 || !allowed.includes(b.role)) return res.status(400).json({ error: 'Provide a valid email, a password of at least 12 characters, and a valid role.' });
  } catch (e) {
app.get('/api/records', auth, (req, res) => res.json(db.prepare('SELECT id,county,site_type,category,period,source,referral_status,created_at FROM research_records ORDER BY id DESC').all()));

app.post('/api/records', auth, role('administrator', 'principal_investigator', 'data_manager'), (req, res) => {
  const county = ['Mombasa', 'Kilifi'].includes(b.county) ? b.county : null;
  const allowedCategory = ['Domestic/IPV', 'Sexual violence', 'Child/forced marriage', 'Technology-facilitated GBV', 'Other approved category'];
  const stmt = db.prepare('INSERT INTO research_records(county,site_type,category,period,source,referral_status) VALUES(?,?,?,?,?,?)');
  audit(req.user.email, 'create_research_record', `Record ${result.lastInsertRowid}`); 
  res.status(201).json({ id: result.lastInsertRowid });


app.post('/api/services', auth, role('administrator', 'principal_investigator'), (req, res) => {
  const b = req.body || {}; 
  if (!b.county || !b.service_name || !b.service_type || !b.verified_on) return res.status(400).json({ error: 'Please fill in all service directory fields.' });
  const result = db.prepare('INSERT INTO service_directory(county,service_name,service_type,verified_on,public_safe) VALUES(?,?,?,?,?)').run(String(b.county), String(b.service_name), String(b.service_type), String(b.verified_on), b.public_safe ? 1 : 0);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.get('/api/audit', auth, role('administrator'), (req, res) => res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all()));

// Catch-all route to serve the frontend

// START THE SERVER (Required for Render)
app.listen(PORT, () => console.log(`Salama Digital running on port ${PORT}`));app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  audit(req.user.email, 'add_service_directory_entry', String(result.lastInsertRowid)); 
app.get('/api/services', auth, (req, res) => res.json(db.prepare('SELECT * FROM service_directory ORDER BY county,service_name').all()));
});
  const result = stmt.run(county, String(b.site_type).slice(0, 80), b.category, String(b.period).slice(0, 20), String(b.source).slice(0, 120), String(b.referral_status || 'Not recorded'));
  if (!county || !b.site_type || !allowedCategory.includes(b.category) || !b.period || !b.source) return res.status(400).json({ error: 'Complete the required fields. Use only approved data.' });
  const b = req.body || {}; 
    res.status(400).json({ error: 'User might already exist.' });

  }
});
  const counties = db.prepare('SELECT county,count(*) n FROM research_records GROUP BY county').all();
  res.json({ metrics: { recordCount: total, countyCount: counties.length, categoryCount: categories.length }, counties, categories, referrals, byQuarter });
});
  const byQuarter = db.prepare('SELECT period,count(*) n FROM research_records GROUP BY period ORDER BY period').all();
  const categories = db.prepare('SELECT category,count(*) n FROM research_records GROUP BY category').all();
  const referrals = db.prepare('SELECT referral_status,count(*) n FROM research_records GROUP BY referral_status').all();

app.get('/api/dashboard', auth, (req, res) => {
  const total = db.prepare('SELECT count(*) n FROM research_records').get().n;
  try { 
    res.status(201).json({ id: result.lastInsertRowid });


