import { api, setToken, setUnauthorizedHandler } from './api.js';
import { h, esc, toast, scoreRing, metricBar, badge, signalRow, scoreColor, lineChart, stackedBar,
  actionBadge, deliverabilityLabel, confidenceLabel, riskChips } from './ui.js';

const app = document.getElementById('app');
let state = { user: null, route: 'dashboard', param: null };

// Redirect to login if the session expires mid-use.
setUnauthorizedHandler(() => {
  setToken(null);
  state.user = null;
  toast('Your session expired. Please sign in again.');
  renderAuth('login');
});

// ---------- bootstrap ----------
init();
async function init() {
  try {
    const { user } = await api.me();
    state.user = user;
    startApp();
  } catch {
    renderAuth('login');
  }
}

function startApp() {
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

function route() {
  const parts = (location.hash.replace(/^#\//, '') || 'dashboard').split('/');
  state.route = parts[0] || 'dashboard';
  state.param = parts[1] || null;
  renderShell();
}

// ================= AUTH =================
function renderAuth(mode) {
  const isLogin = mode === 'login';
  app.innerHTML = '';
  const features = [
    ['✓', 'Multi-level verification', 'Syntax, DNS, MX, SMTP, disposable, role & catch-all detection in one pass.'],
    ['◎', 'Explainable results', 'Every risky address gets a plain-language reason and a clear recommendation.'],
    ['♥', 'List health score', 'A single 0–100 score with deliverability, data-quality, risk & domain metrics.'],
    ['↻', 'Ongoing monitoring', 'Scheduled re-verification, health-drop alerts, and history over time.'],
  ];
  const card = h(`
    <div class="landing">
      <section class="hero">
        <h1 class="brand-lg" style="font-size:34px">Mail<span>Health</span></h1>
        <p class="hero-lead">Know which emails are safe to send — and why.</p>
        <p class="hero-sub">Upload your list. Understand its health. See which contacts to keep,
          review, or remove, with a clear reason for each. Beyond valid/invalid.</p>
        <div class="feature-grid">
          ${features.map(([ic, t, d]) => `
            <div class="feature">
              <div class="feature-ic">${ic}</div>
              <div><b>${t}</b><div class="muted">${d}</div></div>
            </div>`).join('')}
        </div>
      </section>
      <div class="auth-card">
        <h2 style="margin:0 0 4px">${isLogin ? 'Welcome back' : 'Create your account'}</h2>
        <p class="tagline">${isLogin ? 'Sign in to your dashboard.' : 'Start with free verification credits.'}</p>
        ${isLogin ? '' : `<div class="field"><label>Name</label><input id="name" placeholder="Jane Doe" autocomplete="name"/></div>`}
        <div class="field"><label>Email</label><input id="email" type="email" placeholder="you@company.com" autocomplete="email"/></div>
        <div class="field"><label>Password</label><input id="password" type="password" placeholder="••••••••" autocomplete="${isLogin ? 'current-password' : 'new-password'}"/></div>
        ${isLogin ? '' : `<p class="muted" style="font-size:12px;margin:-6px 0 10px">At least 8 characters, with a letter and a number.</p>`}
        <div class="error" id="err"></div>
        <button class="btn block" id="submit">${isLogin ? 'Sign in' : 'Create account'}</button>
        <p class="switch-link">
          ${isLogin ? "No account?" : 'Already registered?'}
          <a id="switch">${isLogin ? 'Create one' : 'Sign in'}</a>
        </p>
      </div>
    </div>`);
  app.appendChild(card);

  card.querySelector('#switch').onclick = () => renderAuth(isLogin ? 'register' : 'login');
  const submit = card.querySelector('#submit');
  const err = card.querySelector('#err');
  async function go() {
    err.textContent = '';
    const email = card.querySelector('#email').value.trim();
    const password = card.querySelector('#password').value;
    const name = isLogin ? undefined : card.querySelector('#name').value.trim();
    try {
      submit.disabled = true;
      const res = isLogin ? await api.login({ email, password }) : await api.register({ email, password, name });
      setToken(res.token);
      state.user = res.user;
      if (!isLogin && res.apiKey) {
        sessionStorage.setItem('newApiKey', res.apiKey);
      }
      startApp();
    } catch (e) {
      err.textContent = e.message;
      submit.disabled = false;
    }
  }
  submit.onclick = go;
  card.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') go(); }));
}

// ================= SHELL =================
function renderShell() {
  const u = state.user;
  const nav = [
    ['dashboard', 'Dashboard'],
    ['lists', 'Lists'],
    ['single', 'Single Check'],
    ['alerts', 'Alerts'],
    ['integrations', 'Integrations'],
    ['api', 'API'],
  ];
  app.innerHTML = '';
  const shell = h(`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">Mail<span>Health</span></div>
        <nav class="nav">
          ${nav.map(([r, label]) => `<a data-r="${r}" class="${state.route === r ? 'active' : ''}">${label}</a>`).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="credits-badge">Credits<br><b id="credits">${u.credits.toLocaleString()}</b></div>
          <div style="margin-top:10px" class="muted">${esc(u.email)}</div>
          <button class="btn ghost sm" id="logout" style="margin-top:10px;width:100%">Log out</button>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`);
  app.appendChild(shell);

  shell.querySelectorAll('.nav a').forEach((a) => {
    a.onclick = () => { location.hash = '#/' + a.dataset.r; };
  });
  shell.querySelector('#logout').onclick = async () => {
    await api.logout(); setToken(null); state.user = null; location.hash = ''; renderAuth('login');
  };

  const main = shell.querySelector('#main');
  const views = {
    dashboard: viewDashboard,
    lists: () => (state.param ? viewListDetail(main, state.param) : viewLists(main)),
    single: viewSingle,
    alerts: viewAlerts,
    integrations: viewIntegrations,
    api: viewApi,
  };
  (views[state.route] || viewDashboard)(main);
  updateAlertBell();
  showVerificationBanner(main);
}

// Honest banner about how accurate verification is in this environment.
async function showVerificationBanner(main) {
  try {
    const { verification: v } = await api.health();
    if (!v || v.mode === 'live-smtp' || v.mode === 'external-provider') return; // real
    const existing = document.getElementById('verifyBanner');
    if (existing) return;
    const banner = h(`
      <div id="verifyBanner" class="banner-warn">
        <b>Limited accuracy in this environment.</b>
        Live mailbox verification (SMTP) isn't available here, so addresses that pass
        syntax/DNS/MX are reported as <b>Unknown</b> rather than Safe — we don't guess.
        For real mailbox-level results, run on a host with outbound port 25 open
        (set <code>SMTP_ENABLED=true</code>) or configure a verification provider.
      </div>`);
    main.prepend(banner);
  } catch { /* ignore */ }
}

async function updateAlertBell() {
  try {
    const { unread } = await api.alerts();
    const link = document.querySelector('.nav a[data-r="alerts"]');
    if (link) link.textContent = unread > 0 ? `Alerts (${unread})` : 'Alerts';
  } catch { /* ignore */ }
}

function refreshCredits() {
  api.me().then(({ user }) => {
    state.user = user;
    const el = document.getElementById('credits');
    if (el) el.textContent = user.credits.toLocaleString();
  });
}

// ================= DASHBOARD =================
async function viewDashboard(main) {
  main.innerHTML = `<h1 class="page-title">Dashboard</h1><p class="page-sub">Upload a list to analyze its deliverability health.</p><div id="content"><p class="muted">Loading…</p></div>`;
  const { lists } = await api.lists();
  const content = main.querySelector('#content');

  const verified = lists.filter((l) => l.health != null);
  const avg = verified.length
    ? Math.round((verified.reduce((s, l) => s + l.health, 0) / verified.length) * 10) / 10
    : 0;
  const totalContacts = lists.reduce((s, l) => s + l.total, 0);

  content.innerHTML = `
    <div class="grid cols-4" style="margin-bottom:24px">
      <div class="card"><div class="stat-label">Lists</div><div class="stat">${lists.length}</div></div>
      <div class="card"><div class="stat-label">Contacts</div><div class="stat">${totalContacts.toLocaleString()}</div></div>
      <div class="card"><div class="stat-label">Avg. Health</div><div class="stat" style="color:${scoreColor(avg)}">${avg || '—'}</div></div>
      <div class="card"><div class="stat-label">Credits</div><div class="stat">${state.user.credits.toLocaleString()}</div></div>
    </div>
    <div class="card">
      <div class="toolbar"><h3 style="margin:0">Upload a new list</h3></div>
      <div class="dropzone" id="drop">
        <p><strong>Drop a CSV, XLSX, or TXT file here</strong> or click to browse</p>
        <p class="muted">The email column is detected automatically. Duplicates are removed.</p>
        <input type="file" id="file" accept=".csv,.xlsx,.xls,.txt" hidden />
      </div>
      <div id="upstatus" style="margin-top:14px"></div>
    </div>`;

  wireUpload(content);
}

function wireUpload(scope) {
  const drop = scope.querySelector('#drop');
  const input = scope.querySelector('#file');
  const status = scope.querySelector('#upstatus');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], status); };
  input.onchange = () => input.files[0] && handleFile(input.files[0], status);
}

async function handleFile(file, status) {
  status.innerHTML = `<p class="muted">Uploading & parsing ${esc(file.name)}…</p>`;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await api.uploadList(fd);
    status.innerHTML = `
      <div class="card" style="background:var(--panel-2)">
        <p>Parsed <b>${r.total.toLocaleString()}</b> unique emails
        (${r.duplicates} duplicates removed) from <b>${esc(r.columnHint || 'file')}</b>.</p>
        <button class="btn" id="startVerify">Verify ${r.total.toLocaleString()} emails (${r.total} credits)</button>
      </div>`;
    status.querySelector('#startVerify').onclick = () => startVerification(r.listId, r.total);
  } catch (e) {
    status.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

async function startVerification(listId, total) {
  try {
    await api.verifyList(listId);
  } catch (e) {
    toast(e.message);
    return;
  }
  location.hash = '#/lists/' + listId;
}

// ================= LISTS =================
async function viewLists(main) {
  main.innerHTML = `<h1 class="page-title">Lists</h1><p class="page-sub">All your uploaded email databases.</p><div id="content"><p class="muted">Loading…</p></div>`;
  const { lists } = await api.lists();
  const content = main.querySelector('#content');
  if (!lists.length) {
    content.innerHTML = `<div class="empty">No lists yet. Upload one from the Dashboard.</div>`;
    return;
  }
  content.innerHTML = lists.map((l) => `
    <div class="list-row" data-id="${l.id}">
      <div class="mini-score" style="color:${l.health != null ? scoreColor(l.health) : 'var(--muted)'}">
        ${l.health != null ? l.health : '—'}
      </div>
      <div style="flex:1">
        <div><b>${esc(l.name)}</b></div>
        <div class="muted">${l.total.toLocaleString()} contacts · ${statusLabel(l.status)} · ${new Date(l.created_at).toLocaleDateString()}</div>
      </div>
      <button class="btn ghost sm" data-del="${l.id}">Delete</button>
    </div>`).join('');

  content.querySelectorAll('.list-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.dataset.del) return;
      location.hash = '#/lists/' + row.dataset.id;
    };
  });
  content.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this list?')) return;
      await api.deleteList(b.dataset.del);
      viewLists(main);
    };
  });
}

function statusLabel(s) {
  return { pending: 'Not verified', verifying: 'Verifying…', done: 'Verified' }[s] || s;
}

// ================= LIST DETAIL =================
async function viewListDetail(main, id) {
  main.innerHTML = `<a href="#/lists" class="muted">← All lists</a><div id="content"><p class="muted">Loading…</p></div>`;
  const content = main.querySelector('#content');

  // If verifying, show progress and poll.
  let detail = await api.listDetail(id);
  if (detail.list.status === 'verifying' || detail.list.status === 'pending') {
    await pollProgress(id, content, detail.list);
    detail = await api.listDetail(id);
  }
  renderDetail(content, detail, id);
}

function pollProgress(id, content, list) {
  return new Promise((resolve) => {
    content.innerHTML = `
      <h1 class="page-title">${esc(list.name)}</h1>
      <div class="card">
        <h3>Verifying…</h3>
        <div class="progress-outer"><div class="progress-inner" id="pi" style="width:0%"></div></div>
        <p class="muted" id="ptext" style="margin-top:10px">Starting…</p>
      </div>`;
    const timer = setInterval(async () => {
      const p = await api.listProgress(id);
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      const pi = content.querySelector('#pi');
      const pt = content.querySelector('#ptext');
      if (pi) pi.style.width = pct + '%';
      if (pt) pt.textContent = `${p.done.toLocaleString()} / ${p.total.toLocaleString()} verified (${pct}%)`;
      if (p.status === 'done') { clearInterval(timer); refreshCredits(); resolve(); }
    }, 800);
  });
}

function renderDetail(content, detail, id) {
  const { list, summary, contacts, history, delta } = detail;
  const m = summary.metrics;

  const deltaHtml = delta != null
    ? `<span class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '▲ +' : '▼ '}${delta} pts since last check</span>`
    : '';

  content.innerHTML = `
    <div class="toolbar">
      <div>
        <h1 class="page-title" style="margin-bottom:2px">${esc(list.name)}</h1>
        <p class="page-sub" style="margin:0">${list.total.toLocaleString()} contacts · ${list.duplicates} duplicates removed · ${deltaHtml}</p>
      </div>
      <div class="spacer"></div>
      <button class="btn ghost sm" id="reverify">Re-verify</button>
      <button class="btn ghost sm" id="schedule">Schedule…</button>
    </div>

    <div class="grid cols-2" style="margin-bottom:16px">
      <div class="card">
        <h3>List Health</h3>
        <div class="ring-wrap">
          ${scoreRing(summary.health, 'out of 100')}
          <div style="flex:1">
            ${metricBar('Deliverability', m.deliverability, 'var(--safe)')}
            ${metricBar('Data quality', m.dataQuality, 'var(--brand)')}
            ${metricBar('Risk', m.risk, 'var(--review)')}
            ${metricBar('Domain health', m.domainHealth, 'var(--brand-2)')}
          </div>
        </div>
        <div style="margin-top:14px">${stackedBar(summary.counts, summary.total)}</div>
      </div>
      <div class="card">
        <h3>Cleaning summary</h3>
        <div class="grid cols-2">
          <div><div class="stat-label">Keep (Safe)</div><div class="stat" style="color:var(--safe)">${summary.counts.safe}</div></div>
          <div><div class="stat-label">Review</div><div class="stat" style="color:var(--review)">${summary.counts.review}</div></div>
          <div><div class="stat-label">Remove</div><div class="stat" style="color:var(--remove)">${summary.counts.remove}</div></div>
          <div><div class="stat-label">Unknown</div><div class="stat" style="color:var(--unknown)">${summary.counts.unknown}</div></div>
        </div>
        <div style="margin-top:14px" class="toolbar">
          <a class="btn sm" href="${api.exportUrl(id, 'campaign')}">Export Safe (CSV)</a>
          <a class="btn ghost sm" href="${api.exportUrl(id, 'all')}">All (CSV)</a>
          <a class="btn ghost sm" href="${api.exportUrl(id, 'all', 'xlsx')}">All (XLSX)</a>
          <button class="btn danger sm" id="purgeRemove">Delete all "Remove"</button>
        </div>
      </div>
    </div>

    ${renderPreflightCard(id)}
    ${history.length > 1 ? renderHistoryWithChart(history) : ''}

    <div class="card" style="margin-top:16px">
      <div class="toolbar">
        <h3 style="margin:0">Contacts</h3>
        <div class="spacer"></div>
        <input id="search" placeholder="Search email…" />
        <select id="filter">
          <option value="all">All</option>
          <option value="safe">Safe</option>
          <option value="review">Review</option>
          <option value="remove">Remove</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <div id="table"></div>
    </div>`;

  loadPreflight(id, content);

  content.querySelector('#reverify').onclick = async () => {
    if (!confirm('Re-verify all contacts? This recharges credits for the whole list.')) return;
    try { await api.reverify(id); toast('Re-verification started'); viewListDetail(document.getElementById('main'), id); }
    catch (e) { toast(e.message); }
  };
  content.querySelector('#schedule').onclick = () => showScheduleModal(id);
  const purge = content.querySelector('#purgeRemove');
  if (purge) purge.onclick = async () => {
    if (!confirm(`Permanently delete ${summary.counts.remove} "Remove" contacts?`)) return;
    const r = await api.bulkContacts(id, 'delete-by-classification', 'remove');
    toast(`Deleted ${r.deleted} contacts`);
    viewListDetail(document.getElementById('main'), id);
  };

  const tableEl = content.querySelector('#table');
  const search = content.querySelector('#search');
  const filter = content.querySelector('#filter');
  function draw() {
    const q = search.value.trim().toLowerCase();
    const f = filter.value;
    const rows = contacts.filter((c) =>
      (f === 'all' || c.classification === f) && (!q || c.email.includes(q)));
    renderContactTable(tableEl, rows);
  }
  search.oninput = draw;
  filter.onchange = draw;
  draw();
}

function renderContactTable(el, rows) {
  if (!rows.length) { el.innerHTML = `<div class="empty">No matching contacts.</div>`; return; }
  el.innerHTML = `
    <table><thead><tr>
      <th>Email</th><th>Deliverability</th><th>Confidence</th><th>Risk signals</th><th>Action</th>
    </tr></thead><tbody>
    ${rows.slice(0, 500).map((c, i) => `
      <tr data-i="${i}">
        <td class="email-cell">${esc(c.email)}</td>
        <td>${deliverabilityLabel(c.deliverability || c.status)}<span class="muted" style="font-size:11px"> · ${c.deliverabilityScore ?? c.score ?? '—'}</span></td>
        <td>${confidenceLabel(c.confidence)}</td>
        <td>${riskSummary(c.riskSignals)}</td>
        <td>${actionBadge(c.recommendedAction || c.classification)}</td>
      </tr>`).join('')}
    </tbody></table>
    ${rows.length > 500 ? `<p class="muted" style="margin-top:10px">Showing first 500 of ${rows.length}. Export for the full list.</p>` : ''}`;

  el.querySelectorAll('tr[data-i]').forEach((tr) => {
    tr.style.cursor = 'pointer';
    tr.onclick = () => showContactModal(rows[parseInt(tr.dataset.i, 10)]);
  });
}

// Compact risk summary for a table cell.
function riskSummary(riskSignals) {
  if (!riskSignals || !riskSignals.length) return '<span class="muted">—</span>';
  const first = riskSignals[0].label;
  const extra = riskSignals.length > 1 ? ` +${riskSignals.length - 1}` : '';
  return `<span class="pill" title="${esc(riskSignals.map(r => r.label).join(', '))}">${esc(first)}${extra}</span>`;
}

function showContactModal(c) {
  const modal = h(`
    <div class="auth-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50">
      <div class="auth-card" style="max-width:560px">
        <div class="toolbar"><h3 style="margin:0" class="email-cell">${esc(c.email)}</h3><div class="spacer"></div>
          ${actionBadge(c.recommendedAction || c.classification)}</div>

        <div class="grid cols-3" style="margin:14px 0">
          <div><div class="stat-label">Deliverability</div>${deliverabilityLabel(c.deliverability || c.status)}
            <div class="muted" style="font-size:11px">score ${c.deliverabilityScore ?? c.score ?? '—'}/100</div></div>
          <div><div class="stat-label">Confidence</div>${confidenceLabel(c.confidence)}</div>
          <div><div class="stat-label">Action</div>${actionBadge(c.recommendedAction || c.classification)}</div>
        </div>

        <div class="stat-label">Risk signals</div>
        <div style="margin:4px 0 12px">${riskChips(c.riskSignals)}</div>

        <h3 style="margin:14px 0 6px;font-size:13px">Technical evidence</h3>
        ${(c.signals || []).map(signalRow).join('')}
        <div class="reasons"><b>Why this classification?</b><ul style="margin:8px 0 0;padding-left:18px">
          ${(c.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}
        </ul></div>
        <div class="recommendation"><b>Recommended action:</b> ${esc(c.recommendation || '')}</div>
        <button class="btn ghost block" id="close" style="margin-top:16px">Close</button>
      </div>
    </div>`);
  document.body.appendChild(modal);
  modal.querySelector('#close').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// ---- Preflight ----
function renderPreflightCard(id) {
  return `<div class="card" id="preflight" style="margin-top:16px"><h3>Campaign Preflight</h3><p class="muted">Loading…</p></div>`;
}
async function loadPreflight(id, content) {
  try {
    const p = await api.preflight(id);
    const el = content.querySelector('#preflight');
    if (!el) return;
    const b = p.buckets;
    const bar = (label, n, color) =>
      `<div class="signal"><span class="dot" style="background:${color}"></span>${n.toLocaleString()} — ${label}</div>`;
    el.innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Campaign Preflight</h3><div class="spacer"></div>
        <span class="pill">${p.recipients.toLocaleString()} recipients</span></div>
      <div class="grid cols-2">
        <div>
          ${bar('Safe', b.safe, 'var(--safe)')}
          ${bar('Review', b.review, 'var(--review)')}
          ${bar('Catch-all', b.catchAll, 'var(--catchall)')}
          ${bar('Invalid', b.invalid, 'var(--remove)')}
          ${bar('Disposable', b.disposable, 'var(--remove)')}
          ${bar('Unknown', b.unknown, 'var(--unknown)')}
        </div>
        <div>
          <div class="stat-label">Recommended send list</div>
          <div class="stat" style="color:var(--safe)">${p.recommendedSendList.toLocaleString()}</div>
          <div class="recommendation" style="margin-top:12px"><b>Can I safely send this campaign?</b><br>${esc(p.verdict)}</div>
          <a class="btn sm" style="margin-top:12px" href="${api.exportUrl(id, 'campaign')}">Download send list</a>
        </div>
      </div>`;
  } catch { /* not verified yet */ }
}

function renderHistoryWithChart(history) {
  const points = history.map((hh) => ({ x: hh.created_at, y: hh.health }));
  return `
    <div class="card" style="margin-top:16px">
      <h3>Historical monitoring</h3>
      ${lineChart(points)}
      <table class="hist-table" style="margin-top:12px"><thead><tr><th>Date</th><th>List Health</th><th>Change</th></tr></thead><tbody>
      ${history.slice().reverse().map((hh, ri, arr) => {
        const i = history.length - 1 - ri;
        const prev = i > 0 ? history[i - 1].health : null;
        const d = prev != null ? Math.round((hh.health - prev) * 10) / 10 : null;
        return `<tr><td>${new Date(hh.created_at).toLocaleString()}</td>
          <td><b style="color:${scoreColor(hh.health)}">${hh.health}</b></td>
          <td class="${d == null ? 'muted' : d >= 0 ? 'delta-up' : 'delta-down'}">${d == null ? '—' : (d >= 0 ? '+' : '') + d}</td></tr>`;
      }).join('')}
      </tbody></table>
    </div>`;
}

function showScheduleModal(id) {
  const modal = h(`
    <div class="auth-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50">
      <div class="auth-card" style="max-width:420px">
        <h3 style="margin-top:0">Schedule re-verification</h3>
        <p class="muted">Automatically re-verify this list on a recurring interval to track health over time.</p>
        <div class="field"><label>Interval (days)</label><input id="days" type="number" value="7" min="1"/></div>
        <div class="toolbar"><button class="btn" id="save">Enable</button><button class="btn ghost" id="cancel">Cancel</button></div>
      </div>
    </div>`);
  document.body.appendChild(modal);
  modal.querySelector('#cancel').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.querySelector('#save').onclick = async () => {
    const days = parseInt(modal.querySelector('#days').value, 10) || 7;
    await api.schedule(id, days, true);
    modal.remove();
    toast(`Scheduled every ${days} day(s)`);
  };
}

// ================= ALERTS =================
async function viewAlerts(main) {
  main.innerHTML = `<div class="toolbar"><h1 class="page-title" style="margin:0">Alerts</h1><div class="spacer"></div><button class="btn ghost sm" id="markRead">Mark all read</button></div>
    <p class="page-sub">Health drops and data-quality changes across your lists.</p><div id="content"><p class="muted">Loading…</p></div>`;
  const { alerts } = await api.alerts();
  const content = main.querySelector('#content');
  if (!alerts.length) { content.innerHTML = `<div class="empty">No alerts. Your lists are healthy.</div>`; }
  else {
    content.innerHTML = alerts.map((a) => `
      <div class="card" style="margin-bottom:10px;border-left:3px solid ${a.level === 'critical' ? 'var(--remove)' : a.level === 'warning' ? 'var(--review)' : 'var(--brand)'}">
        <div class="toolbar"><b>${esc(a.title)}</b><div class="spacer"></div>
          <span class="pill">${a.level}</span><span class="muted">${new Date(a.created_at).toLocaleString()}</span></div>
        <div class="muted">${esc(a.body || '')}</div>
        ${a.list_id ? `<a class="btn ghost sm" style="margin-top:10px" href="#/lists/${a.list_id}">View list</a>` : ''}
      </div>`).join('');
  }
  main.querySelector('#markRead').onclick = async () => { await api.markAlertsRead(); viewAlerts(main); updateAlertBell(); };
}

// ================= INTEGRATIONS =================
async function viewIntegrations(main) {
  main.innerHTML = `<h1 class="page-title">Integrations</h1>
    <p class="page-sub">Send standardized events to Zapier, Make, your CRM, or any endpoint.</p><div id="content"><p class="muted">Loading…</p></div>`;
  const content = main.querySelector('#content');
  const { webhooks } = await api.webhooks();
  content.innerHTML = `
    <div class="card" style="max-width:760px">
      <h3>Webhooks</h3>
      <div class="toolbar">
        <input id="url" placeholder="https://hooks.zapier.com/..." style="flex:1"/>
        <select id="event">
          <option value="job.completed">job.completed</option>
          <option value="health.dropped">health.dropped</option>
          <option value="*">all events</option>
        </select>
        <button class="btn" id="add">Add</button>
      </div>
      <div id="list" style="margin-top:12px"></div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn ghost sm" id="test">Send test event</button>
      </div>
      <h3 style="margin-top:20px">Payload</h3>
      <pre class="reasons" style="overflow:auto"><code>{
  "event": "job.completed",
  "timestamp": "2026-01-01T00:00:00Z",
  "data": { "listId": "...", "listName": "...", "health": 93.8,
            "counts": { "safe": 39102, "review": 1892, "remove": 733, "unknown": 200 } }
}</code></pre>
      <p class="muted">A per-webhook secret (optional) signs each payload with HMAC-SHA256 in the <code>X-MailHealth-Signature</code> header.</p>
    </div>`;

  function drawHooks(hooks) {
    const el = content.querySelector('#list');
    if (!hooks.length) { el.innerHTML = `<p class="muted">No webhooks yet.</p>`; return; }
    el.innerHTML = hooks.map((w) => `
      <div class="list-row" style="cursor:default">
        <div style="flex:1"><b class="email-cell">${esc(w.url)}</b><div class="muted">${esc(w.event)}</div></div>
        <button class="btn ghost sm" data-del="${w.id}">Remove</button>
      </div>`).join('');
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => { await api.deleteWebhook(b.dataset.del); const { webhooks } = await api.webhooks(); drawHooks(webhooks); };
    });
  }
  drawHooks(webhooks);

  content.querySelector('#add').onclick = async () => {
    const url = content.querySelector('#url').value.trim();
    const event = content.querySelector('#event').value;
    if (!url) return;
    try { await api.addWebhook({ url, event }); content.querySelector('#url').value = '';
      const { webhooks } = await api.webhooks(); drawHooks(webhooks); toast('Webhook added'); }
    catch (e) { toast(e.message); }
  };
  content.querySelector('#test').onclick = async () => { await api.testWebhooks(); toast('Test event sent'); };
}

// ================= SINGLE CHECK =================
function viewSingle(main) {
  main.innerHTML = `
    <h1 class="page-title">Single Email Check</h1>
    <p class="page-sub">Verify one address and see the full explanation. Costs 1 credit.</p>
    <div class="card" style="max-width:640px">
      <div class="toolbar">
        <input id="email" placeholder="name@company.com" style="flex:1"/>
        <button class="btn" id="check">Verify</button>
      </div>
      <div id="result"></div>
    </div>`;
  const emailIn = main.querySelector('#email');
  const btn = main.querySelector('#check');
  const result = main.querySelector('#result');
  async function run() {
    const email = emailIn.value.trim();
    if (!email) return;
    result.innerHTML = `<p class="muted">Verifying…</p>`;
    btn.disabled = true;
    try {
      const { result: r, user } = await api.verifySingle(email);
      state.user = user;
      const el = document.getElementById('credits');
      if (el) el.textContent = user.credits.toLocaleString();
      result.innerHTML = renderSingleResult(r);
    } catch (e) {
      result.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  }
  btn.onclick = run;
  emailIn.onkeydown = (e) => { if (e.key === 'Enter') run(); };
}

function renderSingleResult(r) {
  return `
    <div class="ring-wrap" style="margin:16px 0">
      ${scoreRing(r.deliverabilityScore ?? r.score, 'Deliverability')}
      <div>
        <div class="email-cell" style="margin-bottom:8px">${esc(r.email)}</div>
        <div>${actionBadge(r.recommendedAction || r.classification)}</div>
      </div>
    </div>

    <div class="grid cols-3" style="margin:8px 0 16px">
      <div><div class="stat-label">Deliverability</div>${deliverabilityLabel(r.deliverability || r.status)}</div>
      <div><div class="stat-label">Confidence</div>${confidenceLabel(r.confidence)}</div>
      <div><div class="stat-label">Recommended action</div>${actionBadge(r.recommendedAction || r.classification)}</div>
    </div>

    <div class="stat-label">Risk signals</div>
    <div style="margin:4px 0 14px">${riskChips(r.riskSignals)}</div>

    <h3 style="font-size:13px;margin:14px 0 6px">Technical evidence</h3>
    ${(r.signals || []).map(signalRow).join('')}
    <div class="reasons"><b>Why this classification?</b><ul style="margin:8px 0 0;padding-left:18px">
      ${(r.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="recommendation"><b>Recommended action:</b> ${esc(r.recommendation)}</div>`;
}

// ================= API =================
function viewApi(main) {
  const u = state.user;
  // Show the actual backend origin in API examples (may differ from the
  // frontend origin when split-deployed).
  const origin = (window.__API_BASE__ || location.origin).replace(/\/$/, '');
  main.innerHTML = `
    <h1 class="page-title">API</h1>
    <p class="page-sub">Verify emails from your own applications. Standardized results, no provider complexity.</p>
    <div class="card" style="max-width:760px">
      <h3>Your API key</h3>
      <p class="muted" style="margin-top:0">For security, the full key is shown only once when created or rotated. Store it somewhere safe.</p>
      <div class="toolbar">
        <code class="key" id="key">${esc(u.apiKeyPrefix ? u.apiKeyPrefix + '••••••••••••••••' : 'No key yet')}</code>
        <button class="btn ghost sm" id="rotate">Rotate &amp; reveal</button>
      </div>
      <h3 style="margin-top:20px">Verify a single email</h3>
      <pre class="reasons" style="overflow:auto"><code>curl -X POST ${origin}/api/verify/single \\
  -H "X-API-Key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"john@company.com"}'</code></pre>
      <h3 style="margin-top:20px">Response</h3>
      <pre class="reasons" style="overflow:auto"><code>{
  "result": {
    "email": "john@company.com",
    "score": 67,
    "classification": "review",
    "status": "risky",
    "signals": [ { "status": "pass", "label": "Valid syntax" }, ... ],
    "reasons": [ "Catch-all domain detected. ..." ],
    "recommendation": "Use with caution. ..."
  },
  "credits": 4999
}</code></pre>
    </div>`;
  // Reveal the key generated at signup, once.
  const freshKey = sessionStorage.getItem('newApiKey');
  if (freshKey) {
    sessionStorage.removeItem('newApiKey');
    main.querySelector('#key').textContent = freshKey;
    toast('This is your API key — copy it now, it will not be shown again');
  }

  main.querySelector('#rotate').onclick = async () => {
    if (!confirm('Rotate API key? The old key stops working immediately.')) return;
    const { apiKey, apiKeyPrefix } = await api.rotateKey();
    state.user.apiKeyPrefix = apiKeyPrefix;
    main.querySelector('#key').textContent = apiKey;
    toast('New key revealed — copy it now, it will not be shown again');
  };
}
