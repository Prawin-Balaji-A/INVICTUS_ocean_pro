/**
 * ObservationProfileViewer — depth-vs-variable profile chart for a single
 * platform (spec §18/§20/§25).
 *
 * Renders the REAL profile levels returned by the API (depth/pressure + values
 * + per-variable QC flags). Nothing is interpolated or invented: null values
 * are simply not plotted, and if a variable has no valid samples the chart
 * shows an explicit "No data" message.
 *
 * Pure DOM + Canvas2D — no charting dependency. Depth increases downward
 * (oceanographic convention). QC flags are shown and can be filtered
 * ("hide poor quality").
 */

// Argo QC convention: 1 good, 2 probably good, 3 probably bad, 4 bad,
// 5 changed, 8 interpolated, 9 missing.
const QC_GOOD = new Set(['1', '2']);
const QC_POOR = new Set(['3', '4', '9']);

function qcColor(flag) {
  if (flag == null) return '#64748b';           // unknown → slate
  const f = String(flag);
  if (QC_GOOD.has(f)) return '#34d399';          // good → green
  if (QC_POOR.has(f)) return '#f87171';          // poor → red
  return '#fbbf24';                              // other (5/8) → amber
}

function qcLabel(flag) {
  const map = { '1': 'good', '2': 'prob. good', '3': 'prob. bad', '4': 'bad', '5': 'changed', '8': 'interp.', '9': 'missing' };
  return map[String(flag)] || (flag == null ? 'no flag' : `flag ${flag}`);
}

export class ObservationProfileViewer {
  constructor() {
    this.obs = null;
    this.variable = 'TEMP';
    this.hidePoor = false;
    this._injectStyles();
    this._build();
  }

  _injectStyles() {
    if (document.getElementById('dv-profile-style')) return;
    const s = document.createElement('style');
    s.id = 'dv-profile-style';
    s.textContent = `
      #dv-profile {
        position: fixed; right: 16px; bottom: 20px; z-index: 120;
        width: 380px; max-width: calc(100vw - 32px);
        background: rgba(10, 25, 41, 0.92);
        backdrop-filter: blur(16px) saturate(1.3);
        -webkit-backdrop-filter: blur(16px) saturate(1.3);
        border: 1px solid rgba(56, 189, 248, 0.30);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.6), inset 0 0 12px rgba(56,189,248,0.08);
        color: #e0f2fe; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 12px; padding: 12px 14px; display: none;
      }
      #dv-profile.open { display: block; }
      #dv-profile .dvp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
      #dv-profile .dvp-title { font-weight: 700; font-size: 13px; color: #7dd3fc; }
      #dv-profile .dvp-sub { color: #94a3b8; font-size: 11px; line-height: 1.5; margin-top: 2px; }
      #dv-profile .dvp-close { cursor: pointer; color: #94a3b8; border: none; background: none; font-size: 18px; line-height: 1; padding: 0 2px; }
      #dv-profile .dvp-close:hover { color: #f87171; }
      #dv-profile .dvp-controls { display: flex; gap: 6px; align-items: center; margin: 10px 0 6px; flex-wrap: wrap; }
      #dv-profile .dvp-vbtn {
        background: rgba(15,23,42,0.85); border: 1px solid rgba(56,189,248,0.35);
        color: #7dd3fc; padding: 4px 12px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer;
      }
      #dv-profile .dvp-vbtn.active { background: #0284c7; color: #fff; border-color: #38bdf8; }
      #dv-profile label.dvp-chk { display: flex; align-items: center; gap: 5px; margin-left: auto; color: #cbd5e1; font-size: 11px; cursor: pointer; }
      #dv-profile canvas { display: block; width: 100%; height: 300px; margin-top: 4px; }
      #dv-profile .dvp-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; color: #cbd5e1; font-size: 10.5px; }
      #dv-profile .dvp-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
      #dv-profile .dvp-foot { margin-top: 8px; color: #64748b; font-size: 10px; line-height: 1.5; border-top: 1px solid rgba(148,163,184,0.15); padding-top: 6px; }
      #dv-profile .dvp-foot a { color: #38bdf8; text-decoration: none; }
      #dv-profile .dvp-empty { padding: 40px 8px; text-align: center; color: #94a3b8; }
    `;
    document.head.appendChild(s);
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'dv-profile';
    el.innerHTML = `
      <div class="dvp-head">
        <div>
          <div class="dvp-title" id="dvp-title">Profile</div>
          <div class="dvp-sub" id="dvp-sub"></div>
        </div>
        <button class="dvp-close" id="dvp-close" title="Close">×</button>
      </div>
      <div class="dvp-controls">
        <button class="dvp-vbtn active" data-var="TEMP" id="dvp-var-temp">Temperature</button>
        <button class="dvp-vbtn" data-var="PSAL" id="dvp-var-psal">Salinity</button>
        <label class="dvp-chk"><input type="checkbox" id="dvp-hidepoor"> hide poor QC</label>
      </div>
      <canvas id="dvp-canvas"></canvas>
      <div class="dvp-legend">
        <span><i style="background:#34d399"></i>good (1/2)</span>
        <span><i style="background:#fbbf24"></i>other (5/8)</span>
        <span><i style="background:#f87171"></i>poor (3/4/9)</span>
      </div>
      <div class="dvp-foot" id="dvp-foot"></div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('#dvp-canvas');

    el.querySelector('#dvp-close').onclick = () => this.hide();
    el.querySelectorAll('.dvp-vbtn').forEach((b) => {
      b.onclick = () => {
        this.variable = b.dataset.var;
        el.querySelectorAll('.dvp-vbtn').forEach((x) => x.classList.toggle('active', x === b));
        this._render();
      };
    });
    el.querySelector('#dvp-hidepoor').onchange = (e) => {
      this.hidePoor = e.target.checked;
      this._render();
    };
  }

  /** Show and render a profile observation (must include a `.profile` array). */
  show(obs) {
    this.obs = obs;
    this.el.classList.add('open');
    this._render();
  }

  hide() {
    this.el.classList.remove('open');
  }

  /** Show a transient message (e.g. "loading…" or an error) without a profile. */
  showMessage(title, sub, message) {
    this.obs = null;
    this.el.classList.add('open');
    this.el.querySelector('#dvp-title').textContent = title || 'Profile';
    this.el.querySelector('#dvp-sub').textContent = sub || '';
    this.el.querySelector('#dvp-foot').textContent = '';
    const ctx = this._ctx();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._message(message || '');
  }

  _ctx() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || 348;
    const cssH = 300;
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = cssW; this._cssH = cssH;
    return ctx;
  }

  _message(msg) {
    const ctx = this.canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._cssW || 348, this._cssH || 300);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, (this._cssW || 348) / 2, (this._cssH || 300) / 2);
    ctx.textAlign = 'start';
  }

  _render() {
    if (!this.obs) return;
    const o = this.obs;
    const units = o.units || {};
    const meta = o.metadata || {};

    // Header
    const lat = Number.isFinite(o.latitude) ? o.latitude.toFixed(3) : '—';
    const lon = Number.isFinite(o.longitude) ? o.longitude.toFixed(3) : '—';
    this.el.querySelector('#dvp-title').textContent = `Float ${o.platformId}`;
    this.el.querySelector('#dvp-sub').innerHTML =
      `${o.platformType || 'Argo float'} · cycle ${meta.cycle ?? '—'} · ${o.time || '—'}<br>` +
      `lat ${lat}°, lon ${lon}° · ${(meta.nLevels ?? (o.profile ? o.profile.length : 0))} levels · source ${o.source || '—'}`;

    // Footer (traceability + depth note)
    const foot = this.el.querySelector('#dvp-foot');
    const depthNote = units.depth ? `depth: ${units.depth}` : 'depth ≈ pressure (decibar)';
    const srcLink = o.sourceUrl ? ` · <a href="${o.sourceUrl}" target="_blank" rel="noopener">source query ↗</a>` : '';
    foot.innerHTML = `${depthNote}${meta.depthNote ? ' — ' + meta.depthNote : ''}${srcLink}`;

    const ctx = this._ctx();
    ctx.clearRect(0, 0, this._cssW, this._cssH);

    const levels = Array.isArray(o.profile) ? o.profile : [];
    const V = this.variable;
    const points = [];
    for (const lv of levels) {
      const depth = lv.depth ?? lv.pressure;
      const val = lv.values ? lv.values[V] : undefined;
      const flag = lv.qc ? lv.qc[V] : undefined;
      if (depth == null || val == null || !Number.isFinite(val)) continue;
      if (this.hidePoor && QC_POOR.has(String(flag))) continue;
      points.push({ depth, val, flag });
    }

    if (points.length === 0) {
      this._message(`No ${V === 'TEMP' ? 'temperature' : 'salinity'} data for this profile`);
      return;
    }
    this._plot(ctx, points, V, units[V] || '');
  }

  _plot(ctx, points, variable, unit) {
    const W = this._cssW, H = this._cssH;
    const mL = 52, mR = 12, mT = 14, mB = 34;
    const plotW = W - mL - mR;
    const plotH = H - mT - mB;

    let vMin = Infinity, vMax = -Infinity, dMax = -Infinity, dMin = Infinity;
    for (const p of points) {
      if (p.val < vMin) vMin = p.val; if (p.val > vMax) vMax = p.val;
      if (p.depth > dMax) dMax = p.depth; if (p.depth < dMin) dMin = p.depth;
    }
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vPad = (vMax - vMin) * 0.06; vMin -= vPad; vMax += vPad;
    dMin = Math.min(dMin, 0);

    const xOf = (v) => mL + ((v - vMin) / (vMax - vMin)) * plotW;
    const yOf = (d) => mT + ((d - dMin) / (dMax - dMin)) * plotH;

    // Grid + axes
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.fillStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, Consolas, monospace';

    // Y ticks (depth)
    const yTicks = 6;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= yTicks; i++) {
      const d = dMin + (i / yTicks) * (dMax - dMin);
      const y = yOf(d);
      ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(W - mR, y); ctx.stroke();
      ctx.fillText(Math.round(d).toString(), mL - 6, y);
    }
    // X ticks (value)
    const xTicks = 5;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const v = vMin + (i / xTicks) * (vMax - vMin);
      const x = xOf(v);
      ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, H - mB); ctx.stroke();
      ctx.fillText(v.toFixed(1), x, H - mB + 5);
    }

    // Axis labels
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const vname = variable === 'TEMP' ? 'Temperature' : (variable === 'PSAL' ? 'Salinity' : variable);
    ctx.fillText(`${vname}${unit ? ' (' + unit + ')' : ''}`, mL + plotW / 2, H - 4);
    ctx.save();
    ctx.translate(12, mT + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('Depth (m)', 0, 0);
    ctx.restore();

    // Connecting line (depth-ordered)
    const ordered = [...points].sort((a, b) => a.depth - b.depth);
    ctx.strokeStyle = variable === 'TEMP' ? 'rgba(251,146,60,0.85)' : 'rgba(96,165,250,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ordered.forEach((p, i) => {
      const x = xOf(p.val), y = yOf(p.depth);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Points coloured by QC
    for (const p of ordered) {
      ctx.fillStyle = qcColor(p.flag);
      ctx.beginPath();
      ctx.arc(xOf(p.val), yOf(p.depth), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
