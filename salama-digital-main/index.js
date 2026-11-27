require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.warn('WARNING: Set JWT_SECRET to a random secret of at least 32 characters before public hosting.');
}
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],styleSrc:["'self'","https://fonts.googleapis.com","'unsafe-inline'"],fontSrc:["'self'","https://fonts.gstatic.com"],scriptSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:'250kb'}));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({windowMs:15*60*1000, max:10, standardHeaders:true, legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'..','public')));

const dbDir = path.join(__dirname,'data'); fs.mkdirSync(dbDir,{recursive:true});
const db = new Database(path.join(dbDir,'salama.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS research_records(id INTEGER PRIMARY KEY, county TEXT NOT NULL, site_type TEXT NOT NULL, category TEXT NOT NULL, period TEXT NOT NULL, source TEXT NOT NULL, referral_status TEXT DEFAULT 'Not recorded', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY, actor_email TEXT, action TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS service_directory(id INTEGER PRIMARY KEY, county TEXT, service_name TEXT, service_type TEXT, verified_on TEXT, public_safe INTEGER DEFAULT 0);`);
const count = db.prepare('SELECT count(*) n FROM users').get().n;
if (!count) {
  const email=(process.env.ADMIN_EMAIL||'admin@salama.local').toLowerCase();
  const pass=process.env.ADMIN_PASSWORD||'ChangeMe123!';
  db.prepare('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)').run(email,bcrypt.hashSync(pass,12),'administrator');
  console.log(`Seeded admin user: ${email}. Change the password before use.`);
}
const audit=(actor,action,detail='')=>db.prepare('INSERT INTO audit_log(actor_email,action,detail) VALUES(?,?,?)').run(actor,action,detail);
function auth(req,res,next){
  const token=req.cookies.salama_token;
  if(!token)return res.status(401).json({error:'Authentication required'});
  try { req.user=jwt.verify(token,SECRET); next(); }
  catch { res.clearCookie('salama_token'); return res.status(401).json({error:'Session expired'}); }
}
function role(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Insufficient permissions'});}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Salama Digital',mode:'MVP',note:'Use synthetic or approved non-sensitive data only.'}));
app.post('/api/auth/login',(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(); const password=String(req.body.password||'');
  const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!u||!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:'Invalid email or password'});
  const token=jwt.sign({id:u.id,email:u.email,role:u.role},SECRET,{expiresIn:'6h'});
  res.cookie('salama_token',token,{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'strict',maxAge:6*60*60*1000});
  audit(email,'login'); res.json({user:{email:u.email,role:u.role}});
});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('salama_token',{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true'});res.json({ok:true});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
app.post('/api/users',auth,role('administrator'), (req,res)=>{
 const b=req.body||{}; const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||''); const allowed=['administrator','principal_investigator','field_supervisor','research_enumerator','data_manager','institutional_focal_person'];
 if(!email.includes('@')||password.length<12||!allowed.includes(b.role)) return res.status(400).json({error:'Provide a valid email, a password of at least 12 characters, and an approved role.'});
 try { const result=db.prepare('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)').run(email,bcrypt.hashSync(password,12),b.role); audit(req.user.email,'create_user',`${email}:${b.role}`); res.status(201).json({id:result.lastInsertRowid,email,role:b.role}); } catch { res.status(409).json({error:'An account with that email already exists.'}); }
});
app.get('/api/dashboard',auth,(req,res)=>{
  const total=db.prepare('SELECT count(*) n FROM research_records').get().n;
  const counties=db.prepare('SELECT county,count(*) n FROM research_records GROUP BY county').all();
  const categories=db.prepare('SELECT category,count(*) n FROM research_records GROUP BY category').all();
  const referrals=db.prepare('SELECT referral_status,count(*) n FROM research_records GROUP BY referral_status').all();
  const byQuarter=db.prepare('SELECT period,count(*) n FROM research_records GROUP BY period ORDER BY period').all();
  res.json({metrics:{recordCount:total,countyCount:counties.length,categoryCount:categories.length},counties,categories,referrals,byQuarter});
});
app.get('/api/records',auth,(req,res)=>res.json(db.prepare('SELECT id,county,site_type,category,period,source,referral_status,created_at FROM research_records ORDER BY id DESC LIMIT 500').all()));
app.post('/api/records',auth,role('administrator','principal_investigator','data_manager'),(req,res)=>{
 const b=req.body||{}; const county=['Mombasa','Kilifi'].includes(b.county)?b.county:null;
 const allowedCategory=['Domestic/IPV','Sexual violence','Child/forced marriage','Technology-facilitated GBV','Other approved category'];
 if(!county||!b.site_type||!allowedCategory.includes(b.category)||!b.period||!b.source)return res.status(400).json({error:'Complete the required fields. Use only approved, coded, non-identifying records.'});
 const stmt=db.prepare('INSERT INTO research_records(county,site_type,category,period,source,referral_status) VALUES(?,?,?,?,?,?)');
 const result=stmt.run(county,String(b.site_type).slice(0,80),b.category,String(b.period).slice(0,20),String(b.source).slice(0,120),String(b.referral_status||'Not recorded').slice(0,40));
 audit(req.user.email,'create_research_record',`Record ${result.lastInsertRowid}`); res.status(201).json({id:result.lastInsertRowid});
});
app.get('/api/services',auth,(req,res)=>res.json(db.prepare('SELECT * FROM service_directory ORDER BY county,service_name').all()));
app.post('/api/services',auth,role('administrator','principal_investigator'),(req,res)=>{
 const b=req.body||{}; if(!b.county||!b.service_name||!b.service_type||!b.verified_on)return res.status(400).json({error:'Please fill in all service directory fields.'});
 const result=db.prepare('INSERT INTO service_directory(county,service_name,service_type,verified_on,public_safe) VALUES(?,?,?,?,?)').run(String(b.county),String(b.service_name).slice(0,120),String(b.service_type).slice(0,100),String(b.verified_on),b.public_safe?1:0);
 audit(req.user.email,'add_service_directory_entry',String(result.lastInsertRowid)); res.status(201).json({id:result.lastInsertRowid});
});
app.get('/api/audit',auth,role('administrator'), (req,res)=>res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all()));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.listen(PORT,()=>console.log(`Salama Digital running at http://localhost:${PORT}`));
