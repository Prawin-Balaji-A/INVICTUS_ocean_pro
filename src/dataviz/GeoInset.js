/**
 * GeoInset — a compact, fixed bottom-right top-down geographic mini-map.
 *
 * It answers one question at a glance: *where on Earth is the current selection and
 * the loaded model field?* Everything it draws comes from REAL inputs the rest of
 * the app already holds — nothing here is fabricated geography:
 *   • a lat/lon graticule (true grid lines, not coastlines),
 *   • the queried region bounding box (what DataVizPanel actually sent),
 *   • the rendered field footprint (min/max of the real ModelField lat/lon axes),
 *   • the selected-location marker (the exact point the user picked on the globe),
 *   • lat/lon labels for the point and the grid.
 * When a value is absent the corresponding element is simply not drawn — the inset
 * never invents a location, a box, or a name.
 *
 * Coordinates are (lon, lat) in degrees, matching the rest of the geo pipeline.
 * The view window is fitted to keep true aspect at the region's latitude (1° of
 * longitude is compressed by cos(lat)), so the drawn box is not distorted.
 *
 * Theme matches the existing glass chrome (radar / lil-gui): dark translucent panel,
 * cyan (#4fd3ff) accent. It is hidden automatically while the globe is showing
 * (`body.globe-mode`) and appears once the user is in the ocean.
 */

const CY = '#4fd3ff';                 // selection cyan — matches radar + globe pin
const CY_SOFT = 'rgba(79,211,255,';   // prefix for alpha variants

export class GeoInset {
  /** @param {{size?:number}} [opts] canvas width in CSS px (height derives from it) */
  constructor({ size = 184 } = {}) {
    this.W = size;                 // plot/canvas width (CSS px)
    this.H = size + 32;            // + title band (top) + caption band (bottom)
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    this.loc = null;               // { latitude, longitude } — selected point
    this.bbox = null;              // { latMin, latMax, lonMin, lonMax } — queried region
    this.fieldExtent = null;       // { latMin, latMax, lonMin, lonMax } — rendered field
    this.fieldGrid = null;         // real gridded field {lat,lon,values,scale,…} — 2D raster
    this.region = null;            // authoritative sea/ocean name (string) or null
    this.view = null;              // fitted { latMin, latMax, lonMin, lonMax }

    this._injectStyles();
    this._buildDom();
    this.redraw();
  }

  _injectStyles() {
    if (document.getElementById('geo-inset-style')) return;
    const s = document.createElement('style');
    s.id = 'geo-inset-style';
    s.textContent = `
      #geo-inset {
        position: fixed;
        right: 22px;
        bottom: 22px;
        padding: 8px;
        border-radius: 12px;
        background: radial-gradient(circle at 50% 30%, rgba(14,32,46,0.55), rgba(7,17,26,0.78));
        border: 1px solid rgba(150,220,255,0.22);
        box-shadow: 0 10px 30px rgba(0,0,0,0.6), inset 0 0 20px rgba(79,211,255,0.08);
        backdrop-filter: blur(12px) saturate(1.2);
        -webkit-backdrop-filter: blur(12px) saturate(1.2);
        z-index: 95;
        pointer-events: none;   /* purely informational; never intercepts clicks */
        line-height: 0;
      }
      #geo-inset canvas { display: block; border-radius: 6px; }
      body.globe-mode #geo-inset { display: none; }  /* ocean-only chrome */
    `;
    document.head.appendChild(s);
  }

  _buildDom() {
    this.el = document.createElement('div');
    this.el.id = 'geo-inset';

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.el.appendChild(this.canvas);
    document.body.appendChild(this.el);

    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(this.dpr, this.dpr);   // draw in CSS pixels
  }

  // --- real-input setters -----------------------------------------------------

  /** Selected geographic point (from the shared SelectedLocation). */
  setLocation(loc) {
    this.loc = (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude))
      ? { latitude: loc.latitude, longitude: loc.longitude } : null;
    this._fit();
    this.redraw();
  }

  /** The region bounding box actually queried ({latMin,latMax,lonMin,lonMax}). */
  setBbox(bbox) {
    this.bbox = this._validBox(bbox) ? { ...bbox } : null;
    this._fit();
    this.redraw();
  }

  /**
   * Field footprint from the rendered ModelField's REAL axes. Pass the raw
   * `latitude[]` / `longitude[]`; we take their finite min/max. Empty → cleared.
   */
  setFieldExtent(latArr, lonArr) {
    let ext = null;
    if (Array.isArray(latArr) && Array.isArray(lonArr) && latArr.length && lonArr.length) {
      let laMin = Infinity, laMax = -Infinity, loMin = Infinity, loMax = -Infinity;
      for (const v of latArr) if (Number.isFinite(v)) { if (v < laMin) laMin = v; if (v > laMax) laMax = v; }
      for (const v of lonArr) if (Number.isFinite(v)) { if (v < loMin) loMin = v; if (v > loMax) loMax = v; }
      if (laMin <= laMax && loMin <= loMax) ext = { latMin: laMin, latMax: laMax, lonMin: loMin, lonMax: loMax };
    }
    this.fieldExtent = ext;
    this._fit();
    this.redraw();
  }

  /**
   * The REAL gridded field currently shown in the 3D depth slice, reused verbatim
   * as a 2D raster drawn behind the graticule/box/marker. `grid` carries the SAME
   * arrays the 3D layer holds — no separate dataset, no refetch:
   *   { latitude[], longitude[], values[lat][lon], colorScale, variable, depth, units }
   * `colorScale` is the SAME ScientificColorScale the 3D mesh uses, so identical
   * numeric values map to identical colours; a purely-visual recolour mutates that
   * object in place and a later redraw() reflects it. Missing cells (null / non-
   * finite) are left transparent — never zero-filled. Malformed input clears the raster.
   */
  setFieldGrid(grid) {
    const ok = grid
      && Array.isArray(grid.latitude) && grid.latitude.length
      && Array.isArray(grid.longitude) && grid.longitude.length
      && Array.isArray(grid.values)
      && grid.colorScale && typeof grid.colorScale.cssFor === 'function';
    if (!ok) { this.clearField(); return; }
    this.fieldGrid = {
      lat: grid.latitude,
      lon: grid.longitude,
      values: grid.values,
      scale: grid.colorScale,
      latEdges: this._cellEdges(grid.latitude),
      lonEdges: this._cellEdges(grid.longitude),
      variable: grid.variable ? String(grid.variable) : null,
      depth: Number.isFinite(grid.depth) ? grid.depth : null,
      units: grid.units ? String(grid.units) : null,
    };
    // The footprint outline is derived from the SAME real axes; setFieldExtent
    // refits the view and redraws, so the raster and its outline always agree.
    this.setFieldExtent(grid.latitude, grid.longitude);
  }

  /** Drop the rendered field raster + footprint (e.g. when leaving a model dataset). */
  clearField() {
    if (!this.fieldGrid && !this.fieldExtent) return;
    this.fieldGrid = null;
    this.fieldExtent = null;
    this._fit();
    this.redraw();
  }

  /** Authoritative sea/ocean name (already resolved elsewhere), or null. */
  setRegion(name) {
    this.region = name ? String(name) : null;
    this.redraw();
  }

  _validBox(b) {
    return b && Number.isFinite(b.latMin) && Number.isFinite(b.latMax)
      && Number.isFinite(b.lonMin) && Number.isFinite(b.lonMax);
  }

  /**
   * Cell-boundary coordinates for a 1-D axis of n cell CENTRES → n+1 edges, each
   * interior edge the midpoint between neighbours (outer edges extrapolated by half
   * a step). Works for ascending OR descending axes — edges are mapped through
   * sx/sy so ordering is preserved either way — and honours irregular spacing.
   */
  _cellEdges(coords) {
    const n = coords.length;
    if (n === 0) return [];
    if (n === 1) return [coords[0] - 0.5, coords[0] + 0.5];
    const e = new Array(n + 1);
    e[0] = coords[0] - (coords[1] - coords[0]) / 2;
    for (let i = 1; i < n; i++) e[i] = (coords[i - 1] + coords[i]) / 2;
    e[n] = coords[n - 1] + (coords[n - 1] - coords[n - 2]) / 2;
    return e;
  }

  // --- view fitting -----------------------------------------------------------

  /**
   * Fit a square-in-true-distance view window around whatever real data we have
   * (bbox ∪ field footprint ∪ marker), with padding and a sensible minimum so a
   * lone point still shows context. Longitude span is widened by 1/cos(lat) so the
   * on-screen box keeps true aspect and is never stretched.
   */
  _fit() {
    const boxes = [];
    if (this.bbox) boxes.push(this.bbox);
    if (this.fieldExtent) boxes.push(this.fieldExtent);

    let latMin, latMax, lonMin, lonMax;
    if (boxes.length) {
      latMin = Math.min(...boxes.map((b) => b.latMin));
      latMax = Math.max(...boxes.map((b) => b.latMax));
      lonMin = Math.min(...boxes.map((b) => b.lonMin));
      lonMax = Math.max(...boxes.map((b) => b.lonMax));
    } else if (this.loc) {
      latMin = latMax = this.loc.latitude;
      lonMin = lonMax = this.loc.longitude;
    } else {
      this.view = null;
      return;
    }
    if (this.loc) {
      latMin = Math.min(latMin, this.loc.latitude);
      latMax = Math.max(latMax, this.loc.latitude);
      lonMin = Math.min(lonMin, this.loc.longitude);
      lonMax = Math.max(lonMax, this.loc.longitude);
    }

    const cLat = (latMin + latMax) / 2;
    const cLon = (lonMin + lonMax) / 2;
    const cosc = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));

    const MIN_HALF = 0.75;   // degrees of latitude — floor so a point isn't a dot in a void
    const PAD = 1.35;        // 35% breathing room around the data
    const halfLatEq = (latMax - latMin) / 2;
    const halfLonEq = ((lonMax - lonMin) / 2) * cosc;   // lon span → lat-equivalent distance
    const half = Math.max(halfLatEq, halfLonEq, MIN_HALF) * PAD;

    this.view = {
      latMin: cLat - half,
      latMax: cLat + half,
      lonMin: cLon - half / cosc,
      lonMax: cLon + half / cosc,
    };
  }

  // --- rendering --------------------------------------------------------------

  redraw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    // Bands: title (top 18px), map (square W×W below it), caption (bottom 14px).
    const titleH = 18;
    const capH = 14;
    const mapTop = titleH;
    const mapSize = W;                 // square map area
    const PADL = 26, PADR = 8, PADT = 8, PADB = 20;   // gutters inside the map for labels
    const plot = {
      l: PADL,
      t: mapTop + PADT,
      r: W - PADR,
      b: mapTop + mapSize - PADB,
    };
    plot.w = plot.r - plot.l;
    plot.h = plot.b - plot.t;

    const font = '"Segoe UI", system-ui, -apple-system, sans-serif';

    // Title — the authoritative region name (or a neutral label; never invented).
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `600 11px ${font}`;
    ctx.fillStyle = '#9be7ff';
    const title = (this.region ? this.region.toUpperCase() : 'GEO VIEW');
    ctx.fillText(this._ellipsize(title, W - 16), 8, 13);

    // Plot frame + faint ocean tint so the map reads as water.
    ctx.fillStyle = 'rgba(10,26,40,0.45)';
    ctx.fillRect(plot.l, plot.t, plot.w, plot.h);
    ctx.strokeStyle = 'rgba(150,220,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.l + 0.5, plot.t + 0.5, plot.w - 1, plot.h - 1);

    if (!this.view) {
      ctx.fillStyle = 'rgba(200,230,245,0.55)';
      ctx.font = `10px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText('Pick a location', plot.l + plot.w / 2, plot.t + plot.h / 2);
      return;
    }

    const v = this.view;
    const sx = (lon) => plot.l + ((lon - v.lonMin) / (v.lonMax - v.lonMin)) * plot.w;
    const sy = (lat) => plot.t + ((v.latMax - lat) / (v.latMax - v.latMin)) * plot.h;

    // Clip geometry to the plot so nothing bleeds into the gutters/labels.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.l, plot.t, plot.w, plot.h);
    ctx.clip();

    // --- real gridded field raster (behind everything; missing cells transparent) ---
    this._drawField(ctx, sx, sy);

    // --- graticule (real lat/lon grid) ---
    const spanLat = v.latMax - v.latMin;
    const step = this._niceStep(spanLat / 3.2);
    const dec = step < 1 ? 1 : 0;
    ctx.lineWidth = 1;
    ctx.font = `9px ${font}`;

    // latitude lines (horizontal)
    const lat0 = Math.ceil(v.latMin / step) * step;
    for (let lat = lat0; lat <= v.latMax + 1e-9; lat += step) {
      const y = sy(lat);
      ctx.strokeStyle = 'rgba(150,220,255,0.10)';
      ctx.beginPath(); ctx.moveTo(plot.l, y); ctx.lineTo(plot.r, y); ctx.stroke();
    }
    // longitude lines (vertical)
    const lon0 = Math.ceil(v.lonMin / step) * step;
    for (let lon = lon0; lon <= v.lonMax + 1e-9; lon += step) {
      const x = sx(lon);
      ctx.strokeStyle = 'rgba(150,220,255,0.10)';
      ctx.beginPath(); ctx.moveTo(x, plot.t); ctx.lineTo(x, plot.b); ctx.stroke();
    }

    // --- queried region bbox (dashed light blue) ---
    if (this.bbox) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(150,220,255,0.75)';
      ctx.lineWidth = 1;
      const x = sx(this.bbox.lonMin), y = sy(this.bbox.latMax);
      ctx.strokeRect(x, y, sx(this.bbox.lonMax) - x, sy(this.bbox.latMin) - y);
      ctx.setLineDash([]);
    }

    // --- rendered field footprint (solid cyan, faint fill) ---
    if (this.fieldExtent) {
      const x = sx(this.fieldExtent.lonMin), y = sy(this.fieldExtent.latMax);
      const w = sx(this.fieldExtent.lonMax) - x, h = sy(this.fieldExtent.latMin) - y;
      ctx.fillStyle = CY_SOFT + '0.16)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = CY_SOFT + '0.9)';
      ctx.lineWidth = 1.25;
      ctx.strokeRect(x, y, w, h);
    }

    // --- selected-location marker (crosshair + dot) ---
    if (this.loc) {
      const mx = sx(this.loc.longitude), my = sy(this.loc.latitude);
      const inX = mx >= plot.l && mx <= plot.r;
      const inY = my >= plot.t && my <= plot.b;
      if (inX && inY) {
        ctx.strokeStyle = CY_SOFT + '0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(plot.l, my); ctx.lineTo(plot.r, my);
        ctx.moveTo(mx, plot.t); ctx.lineTo(mx, plot.b); ctx.stroke();
        // glow ring + white core
        ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2);
        ctx.strokeStyle = CY; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
      }
    }

    ctx.restore();   // end clip

    // --- axis labels (drawn in the gutters, outside the clip) ---
    ctx.fillStyle = 'rgba(150,220,255,0.6)';
    ctx.font = `9px ${font}`;
    // latitude labels (left gutter)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let lat = lat0; lat <= v.latMax + 1e-9; lat += step) {
      const y = sy(lat);
      if (y < plot.t + 5 || y > plot.b - 5) continue;
      ctx.fillText(this._fmtLat(lat, dec), plot.l - 3, y);
    }
    // longitude labels (bottom gutter)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let lon = lon0; lon <= v.lonMax + 1e-9; lon += step) {
      const x = sx(lon);
      if (x < plot.l + 8 || x > plot.r - 8) continue;
      ctx.fillText(this._fmtLon(lon, dec), x, plot.b + 4);
    }

    // --- caption: the exact selected coordinates (full precision) ---
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `10px ${font}`;
    ctx.fillStyle = 'rgba(205,232,248,0.9)';
    const cap = this.loc
      ? `${this._fmtLat(this.loc.latitude, 3)} · ${this._fmtLon(this.loc.longitude, 3)}`
      : '—';
    // Field tag (right of the caption) — e.g. "TEMP · 5 m"; leave room for the coords.
    const flabel = this._fieldLabel();
    ctx.fillText(this._ellipsize(cap, W - (flabel ? 74 : 16)), 8, H - capH + 10);
    if (flabel) {
      ctx.textAlign = 'right';
      ctx.font = `9px ${font}`;
      ctx.fillStyle = CY_SOFT + '0.8)';
      ctx.fillText(this._ellipsize(flabel, 64), W - 8, H - capH + 10);
    }
  }

  /**
   * Paint the real gridded field as a 2-D raster — one fillRect per grid cell,
   * positioned with the SAME sx/sy the graticule uses (true lon/lat). Colour comes
   * from the shared ScientificColorScale (identical mapping to the 3D slice and the
   * colorbar). Missing cells (cssFor → null) are skipped so they stay transparent —
   * never zero-filled or interpolated. Runs only on a field change / recolour (never
   * per animation frame), inside the plot clip, before the graticule/box/marker.
   */
  _drawField(ctx, sx, sy) {
    const g = this.fieldGrid;
    if (!g) return;
    const { values, latEdges, lonEdges, scale } = g;
    const nLat = g.lat.length, nLon = g.lon.length;
    for (let i = 0; i < nLat; i++) {
      const row = values[i];
      if (!row) continue;
      const yA = sy(latEdges[i]);
      const yB = sy(latEdges[i + 1]);
      const yT = Math.min(yA, yB);
      const hh = Math.abs(yB - yA) + 0.6;   // +0.6 closes sub-pixel seams between cells
      for (let j = 0; j < nLon; j++) {
        const css = scale.cssFor(row[j]);
        if (!css) continue;                  // missing value → left transparent
        const xA = sx(lonEdges[j]);
        const xB = sx(lonEdges[j + 1]);
        const xL = Math.min(xA, xB);
        const ww = Math.abs(xB - xA) + 0.6;
        ctx.fillStyle = css;
        ctx.fillRect(xL, yT, ww, hh);
      }
    }
  }

  /** Compact "VARIABLE · DEPTH m" tag for the current field, or '' when none. */
  _fieldLabel() {
    const g = this.fieldGrid;
    if (!g) return '';
    const parts = [];
    if (g.variable) parts.push(g.variable.toUpperCase());
    if (g.depth !== null) {
      const d = g.depth;
      const ds = Number.isInteger(d) ? String(d) : d.toFixed(Math.abs(d) >= 100 ? 0 : 1);
      parts.push(`${ds} m`);
    }
    return parts.join(' · ');
  }

  // --- helpers ----------------------------------------------------------------

  /** Pick a human-friendly grid step (deg) near the requested one. */
  _niceStep(x) {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30];
    for (const s of steps) if (x <= s) return s;
    return 45;
  }

  _fmtLat(v, dec) {
    const h = v >= 0 ? 'N' : 'S';
    return `${Math.abs(v).toFixed(dec)}°${h}`;
  }

  _fmtLon(v, dec) {
    let x = ((v + 180) % 360 + 360) % 360 - 180;
    const h = x >= 0 ? 'E' : 'W';
    return `${Math.abs(x).toFixed(dec)}°${h}`;
  }

  _ellipsize(text, maxPx) {
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxPx) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxPx) t = t.slice(0, -1);
    return t + '…';
  }

  /** Total on-screen height (px) including chrome — used to stack the radar above. */
  outerHeight() {
    return this.el ? this.el.getBoundingClientRect().height : this.H + 18;
  }

  dispose() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}
