// All data comes from /api; nothing sensitive is placed in URLs. DOM built with textContent (no innerHTML).
const root = document.getElementById('root');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); kids.forEach((k) => n.append(k)); return n; };
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || j.error), { code: j.error }); return j;
}

function loginView(msg = '', needTotp = false) {
  const u = el('input', { id: 'u', autocomplete: 'username' }), p = el('input', { id: 'p', type: 'password', autocomplete: 'current-password' });
  const t = el('input', { id: 't', inputMode: 'numeric', autocomplete: 'one-time-code' });
  const err = el('p', { className: 'error', role: 'alert', textContent: msg });
  const btn = el('button', { className: 'primary', textContent: 'Sign in' });
  btn.onclick = async () => {
    try { await api('/auth/login', 'POST', { username: u.value, password: p.value, totp: t.value || undefined }); start(); }
    catch (e) { e.code === 'mfa_required' ? loginView('Enter your authentication code.', true) : loginView(e.message); }
  };
  root.replaceChildren(el('div', { className: 'card' }, el('h1', { textContent: 'Sign in' }),
    el('label', { htmlFor: 'u', textContent: 'Username' }), u, el('label', { htmlFor: 'p', textContent: 'Password' }), p,
    ...(needTotp ? [el('label', { htmlFor: 't', textContent: 'Authentication code' }), t] : []), err, btn));
}

async function start() {
  let me; try { me = await api('/auth/me'); } catch { return loginView(); }
  const view = el('section', { className: 'content' });
  const items = [['Security', securityView]];
  if (me.permissions.includes('users:manage')) items.push(['Users', usersView]);
  if (me.permissions.includes('audit:read')) items.push(['Audit log', auditView]);
  if (me.permissions.includes('datasets:pi:read')) items.push(['Datasets', datasetsView]);
  const nav = el('nav', { className: 'sidebar', 'aria-label': 'Main' }, el('h2', { textContent: 'Salama Digital' }));
  const so = el('button', { className: 'primary', textContent: 'Sign out' }); so.style.margin = '1rem';
  so.onclick = async () => { await api('/auth/logout', 'POST'); loginView(); };
  const show = (name, fn) => { nav.querySelectorAll('button[data-n]').forEach((b) => b.toggleAttribute('aria-current', false) || (b.dataset.n === name && b.setAttribute('aria-current', 'page'))); fn(view, me); };
  items.forEach(([name, fn]) => { const b = el('button', { textContent: name }); b.dataset.n = name; b.onclick = () => show(name, fn); nav.append(b); });
  nav.append(so);
  root.replaceChildren(el('div', { className: 'layout' }, nav, view));
  show('Security', securityView);
}

function table(rows, cols) {
  const t = el('table', {}, el('tr', {}, ...cols.map((c) => el('th', { textContent: c }))));
  rows.forEach((r) => t.append(el('tr', {}, ...cols.map((c) => el('td', { textContent: String(r[c] ?? '') })))));
  return t;
}
function securityView(v, me) {
  const out = el('div'); const b = el('button', { className: 'secondary', textContent: me.mfaEnabled ? 'MFA enabled' : 'Set up MFA' }); b.disabled = me.mfaEnabled;
  b.onclick = async () => {
    const s = await api('/auth/mfa/enroll', 'POST'); const c = el('input', { inputMode: 'numeric', 'aria-label': 'Code' }); const ok = el('button', { className: 'primary', textContent: 'Confirm' });
    ok.onclick = async () => { try { await api('/auth/mfa/confirm', 'POST', { code: c.value }); start(); } catch (e) { out.append(el('p', { className: 'error', textContent: e.message })); } };
    out.replaceChildren(el('p', { textContent: 'Add this key to your authenticator app, then enter the 6-digit code:' }), el('code', { textContent: s.secret }), el('br'), c, ok);
  };
  v.replaceChildren(el('h1', { textContent: 'Security' }), el('p', { textContent: `Signed in as ${me.displayName} (${me.role.replaceAll('_', ' ')})` }),
    ...(me.mfaEnrollmentRequired ? [el('p', { className: 'error', textContent: 'MFA enrolment is required for your role before you can access other modules.' })] : []),
    ...(me.mustChangePassword ? [el('p', { className: 'error', textContent: 'You must change your temporary password.' })] : []), b, out);
}
async function usersView(v) { v.replaceChildren(el('h1', { textContent: 'Users' }), table(await api('/users'), ['username', 'display_name', 'role', 'is_active', 'mfa_enabled'])); }
async function auditView(v) { v.replaceChildren(el('h1', { textContent: 'Audit log' }), table(await api('/audit'), ['ts', 'action', 'outcome', 'actor_id'])); }
async function datasetsView(v) { const d = await api('/datasets/pi-restricted'); v.replaceChildren(el('h1', { textContent: 'Datasets' }), d.length ? table(d, ['code', 'title', 'created_at']) : el('p', { textContent: 'No datasets have been registered yet.' })); }

start();
