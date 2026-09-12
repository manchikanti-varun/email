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
