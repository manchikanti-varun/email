// Small DOM + rendering helpers shared across views.

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function toast(msg) {
  const el = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// Inline SVG icons for the sidebar nav, keyed by route.
const NAV_ICONS = {
  dashboard: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  lists: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/></svg>',
  single: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
  alerts: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  integrations: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  api: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  agent: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v0a3 3 0 0 0-3 3 3 3 0 0 0 0 6 3 3 0 0 0 3 3v0a3 3 0 0 0 6 0v0a3 3 0 0 0 3-3 3 3 0 0 0 0-6 3 3 0 0 0-3-3v0a3 3 0 0 0-3-3z"/><path d="M12 8v8M9 12h6"/></svg>',
};
export function navIcon(route) {
  return `<span class="nav-ic">${NAV_ICONS[route] || ''}</span>`;
}

// Skeleton placeholder markup for loading states.
export function skeletonCards(n = 4) {
  return `<div class="grid cols-4" style="margin-bottom:24px">${
    Array.from({ length: n }, () => '<div class="card"><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line" style="width:60%;height:26px"></div></div>').join('')
  }</div><div class="skeleton skeleton-card"></div>`;
}
export function skeletonRows(n = 4) {
  return Array.from({ length: n }, () =>
    '<div class="card" style="margin-bottom:12px"><div class="skeleton skeleton-line" style="width:45%"></div><div class="skeleton skeleton-line short" style="margin-bottom:0"></div></div>'
  ).join('');
}

export function scoreColor(score) {
  if (score >= 80) return 'var(--safe)';
  if (score >= 60) return 'var(--review)';
  if (score >= 35) return 'var(--catchall)';
  return 'var(--remove)';
}

// SVG donut ring for a 0-100 score.
export function scoreRing(score, label = 'Health') {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  const color = scoreColor(score);
  return `
  <div class="ring">
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--bg-2)" stroke-width="12"/>
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${dash} ${c}"/>
    </svg>
    <div class="val"><b>${score}</b><small>${esc(label)}</small></div>
  </div>`;
}

export function metricBar(label, value, color = 'var(--brand)') {
  return `
  <div class="metric">
    <div class="row"><span>${esc(label)}</span><span>${value}%</span></div>
    <div class="bar"><span style="width:${value}%;background:${color}"></span></div>
  </div>`;
}

export function badge(classification) {
  return `<span class="badge ${classification}"><span class="dot ${classification}"></span>${classification}</span>`;
}

const SIGNAL_ICON = { pass: '✓', warn: '⚠', fail: '✕', info: 'i' };
export function signalRow(s) {
  return `<div class="signal ${s.status}"><span class="ic">${SIGNAL_ICON[s.status] || '•'}</span><span>${esc(s.label)}</span></div>`;
}

// ---- Dimension helpers (Evidence -> Confidence -> Action model) -----------
const ACTION_STYLE = {
  keep:     { label: 'KEEP',     color: 'var(--safe)' },
  review:   { label: 'REVIEW',   color: 'var(--review)' },
  reverify: { label: 'REVERIFY', color: 'var(--catchall)' },
  remove:   { label: 'REMOVE',   color: 'var(--remove)' },
};
export function actionBadge(action) {
  const a = ACTION_STYLE[action] || { label: (action || '—').toUpperCase(), color: 'var(--muted)' };
  return `<span class="badge" style="background:${a.color}22;color:${a.color}">${a.label}</span>`;
}

const DELIV_STYLE = {
  deliverable:   { label: 'Deliverable',   color: 'var(--safe)' },
  risky:         { label: 'Catch-all',     color: 'var(--catchall)' },
  unknown:       { label: 'Unconfirmed',   color: 'var(--unknown)' },
  undeliverable: { label: 'Undeliverable', color: 'var(--remove)' },
};
export function deliverabilityLabel(d) {
  const s = DELIV_STYLE[d] || { label: d || '—', color: 'var(--muted)' };
  return `<span style="color:${s.color};font-weight:600">${s.label}</span>`;
}

const CONF_COLOR = { high: 'var(--safe)', medium: 'var(--review)', low: 'var(--catchall)', unknown: 'var(--unknown)' };
export function confidenceLabel(c) {
  const color = CONF_COLOR[c] || 'var(--muted)';
  return `<span style="color:${color};text-transform:capitalize">${esc(c || 'unknown')}</span>`;
}

// ---- ML calibrated confidence (additive; renders nothing if absent) --------
// Explains three things together (task §24): what the engine found (already
// shown elsewhere), HOW confident MailHealth is, and WHY. Never overrides the
// deterministic verdict — it sits beside it.
const CAL_LEVEL_COLOR = { HIGH: 'var(--safe)', MEDIUM: 'var(--review)', LOW: 'var(--catchall)' };
export function calibratedConfidence(cal) {
  if (!cal || typeof cal !== 'object') return '';
  const pct = Number.isFinite(cal.score) ? Math.round(cal.score * 100) : null;
  const color = CAL_LEVEL_COLOR[cal.level] || 'var(--muted)';
  const modelTag = cal.available
    ? `<span class="pill" style="margin-left:6px" title="Calibration model version">${esc(cal.model || 'ml')}</span>`
    : `<span class="pill" style="margin-left:6px;opacity:.7" title="ML model unavailable — showing deterministic confidence">deterministic</span>`;

  const evidence = Array.isArray(cal.evidence) && cal.evidence.length
    ? `<ul style="margin:6px 0 0;padding-left:2px;list-style:none;font-size:12px">${
      cal.evidence.slice(0, 6).map((e) =>
        `<li style="margin-bottom:2px"><span style="color:${e.sign === '+' ? 'var(--safe)' : 'var(--catchall)'};font-weight:700">${esc(e.sign)}</span> ${esc(e.text)}</li>`
      ).join('')}</ul>`
    : '';

  const warn = cal.disagreement && cal.disagreement.warning
    ? `<div class="reasons" style="border-color:var(--catchall);margin-top:8px"><b>⚠ Review / calibration case:</b> ${esc(cal.disagreement.warning)}</div>`
    : '';

  const unavailable = cal.available === false && cal.message
    ? `<div class="muted" style="font-size:11px;margin-top:4px">${esc(cal.message.replace(/\n/g, ' · '))}</div>`
    : '';

  return `
    <div class="card" style="margin-top:14px;background:var(--panel-2,transparent)">
      <div class="stat-label">MailHealth confidence in this result ${modelTag}</div>
      <div style="display:flex;align-items:baseline;gap:10px;margin:4px 0">
        <span style="font-size:22px;font-weight:700;color:${color}">${pct == null ? '—' : pct + '%'}</span>
        <span style="color:${color};font-weight:600">${esc(cal.level || '—')}</span>
      </div>
      <div class="muted" style="font-size:12px">${esc(cal.interpretation || '')}</div>
      ${evidence}
      ${warn}
      ${unavailable}
    </div>`;
}

// Compact inline calibrated badge for tables (level + %). Renders nothing if absent.
export function calibratedBadge(cal) {
  if (!cal || typeof cal !== 'object' || cal.level == null) return '';
  const pct = Number.isFinite(cal.score) ? Math.round(cal.score * 100) : null;
  const color = CAL_LEVEL_COLOR[cal.level] || 'var(--muted)';
  const title = cal.available ? `Calibrated (${esc(cal.model || 'ml')})` : 'Deterministic fallback';
  return `<span class="pill" title="${title}" style="color:${color}">${esc(cal.level)}${pct == null ? '' : ' ' + pct + '%'}</span>`;
}

export function riskChips(riskSignals) {
  if (!riskSignals || !riskSignals.length) {
    return '<span class="muted">None detected</span>';
  }
  return riskSignals.map((r) =>
    `<span class="pill" title="${esc(r.detail || '')}" style="margin:2px 4px 2px 0">${esc(r.label)}</span>`
  ).join('');
}

// Simple inline SVG line chart for health-over-time (points: [{x,y}]).
export function lineChart(points, opts = {}) {
  const w = opts.width || 520, hgt = opts.height || 160, pad = 28;
  if (!points.length) return '<p class="muted">No history yet.</p>';
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 100);
  const range = maxY - minY || 1;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const px = (i) => pad + i * stepX;
  const py = (v) => hgt - pad - ((v - minY) / range) * (hgt - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) =>
    `<circle cx="${px(i).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5" fill="${scoreColor(p.y)}"/>`).join('');
  const gridY = [0, 25, 50, 75, 100].map((v) =>
    `<line x1="${pad}" y1="${py(v)}" x2="${w - pad}" y2="${py(v)}" stroke="var(--border)" stroke-dasharray="3 4"/>
     <text x="4" y="${py(v) + 3}" fill="var(--muted)" font-size="9">${v}</text>`).join('');
  return `<svg width="100%" viewBox="0 0 ${w} ${hgt}" style="max-width:${w}px">
    ${gridY}
    <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="2"/>
    ${dots}
  </svg>`;
}

// Horizontal stacked bar for classification breakdown.
export function stackedBar(counts, total) {
  if (!total) return '';
  const seg = (n, color, label) => n
    ? `<div title="${label}: ${n}" style="width:${(n / total) * 100}%;background:${color};height:100%"></div>` : '';
  return `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">
    ${seg(counts.safe, 'var(--safe)', 'Safe')}
    ${seg(counts.review, 'var(--review)', 'Review')}
    ${seg(counts.unknown, 'var(--unknown)', 'Unknown')}
    ${seg(counts.remove, 'var(--remove)', 'Remove')}
  </div>`;
}
