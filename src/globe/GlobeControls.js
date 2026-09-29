/**
 * GlobeControls — self-injected UI for the globe entry point. It mirrors the
 * DataVizPanel inject pattern (its own <style> + DOM, no edits to UIManager) and
 * provides exactly two small surfaces so the existing UI is not redesigned:
 *
 *   #globe-hud        (globe mode)  title + instructions, the live selected
 *                                   lat/lon readout, and the "Explore Ocean" button.
 *   #ocean-loc-badge  (ocean mode)  a compact pill showing the selected lat/lon
 *                                   with a "Return to Globe" button.
 *
 * It also injects the `body.globe-mode` rules that hide the existing ocean chrome
 * (lil-gui, sim toolbar, ocean-data launcher/panel, depth HUD, hint) while the
 * globe is on screen, and restores them on return.
 */
export class GlobeControls {
  constructor() {
    this._onExplore = null;
    this._onReturn = null;
    this._loc = null;
    this._injectStyles();
    this._build();
  }

  _injectStyles() {
    if (document.getElementById('globe-ctrl-style')) return;
    const s = document.createElement('style');
    s.id = 'globe-ctrl-style';
    s.textContent = `
      /* Hide the existing ocean chrome while the globe is the active mode. */
      body.globe-mode .lil-gui.root,
      body.globe-mode #sim-toolbar,
      body.globe-mode #dv-launch,
      body.globe-mode #dv-panel,
      body.globe-mode #depth,
      body.globe-mode #hint,
      body.globe-mode #radar,
      body.globe-mode #ocean-ui-container { display: none !important; }

      #globe-hud {
        position: fixed; top: 18px; left: 18px; z-index: 130; display: none;
        width: 300px; max-width: calc(100vw - 36px);
        background: rgba(8, 17, 28, 0.86);
        backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
        border: 1px solid rgba(56,189,248,0.30); border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.6);
        color: #e0f2fe; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 12px; padding: 14px 16px;
      }
      body.globe-mode #globe-hud { display: block; }
      #globe-hud h2 { font-size: 14px; color: #7dd3fc; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.02em; }
      #globe-hud .g-note { color: #94a3b8; font-size: 11px; line-height: 1.5; margin-bottom: 10px; }
      #globe-hud .g-warn { color: #fbbf24; font-size: 10.5px; line-height: 1.5; margin-bottom: 10px; display: none; }
      #globe-hud .g-warn.show { display: block; }
      /* §1: shown when the user clicks a LAND pixel — stay on the globe, prompt
         for an ocean. Distinct from .g-warn (asset-missing) so neither clobbers
         the other. */
      #globe-hud .g-hint { color: #fca5a5; font-size: 11px; line-height: 1.5; margin-top: 10px; display: none; }
      #globe-hud .g-hint.show { display: block; }
      #globe-hud .g-loc-l { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
      #globe-hud .g-loc {
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14px; font-weight: 600;
        color: #eaf7fd; min-height: 18px; margin-bottom: 4px;
      }
      #globe-hud .g-loc.empty { color: #64748b; font-weight: 400; font-size: 12px; }
      #globe-hud .g-region {
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5px;
        color: #7891a8; line-height: 1.5; margin-bottom: 12px; min-height: 14px;
      }
      /* Authoritative sea/ocean name for the selected point (point-in-polygon,
         real data). Previewed on the globe before diving; never fabricated. */
      #globe-hud .g-sea {
        font-weight: 800; font-size: 12.5px; letter-spacing: 0.03em; color: #7dd3fc;
        text-transform: uppercase; margin: 2px 0 8px; min-height: 15px; display: none;
      }
      #globe-hud .g-sea.show { display: block; }
      #globe-explore {
        width: 100%; background: #0284c7; color: #fff; border: 1px solid #38bdf8;
        border-radius: 9px; padding: 10px; font-size: 13px; font-weight: 700; cursor: pointer;
        transition: background 0.14s;
      }
      #globe-explore:hover:not([disabled]) { background: #0ea5e9; }
      #globe-explore[disabled] { opacity: 0.45; cursor: default; }

      #ocean-loc-badge {
        position: fixed; top: 12px; left: 132px; z-index: 130;
        display: none; align-items: center; gap: 10px;
        max-width: min(330px, calc(100vw - 150px));
        background: rgba(8, 17, 28, 0.82);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(56,189,248,0.30); border-radius: 999px;
        padding: 6px 8px 6px 14px; color: #e0f2fe;
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.5);
      }
      #ocean-loc-badge.show { display: flex; }
      body.globe-mode #ocean-loc-badge { display: none !important; }
      #ocean-loc-badge .b-stack { display: flex; flex-direction: column; gap: 1px; }
      /* Prominent authoritative sea/ocean name (real, point-in-polygon). Sits
         above the exact coordinates so the badge reads "BAY OF BENGAL / Lat…Lon…". */
      #ocean-loc-badge .b-sea {
        font-weight: 800; font-size: 12.5px; letter-spacing: 0.04em; color: #7dd3fc;
        text-transform: uppercase; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; max-width: 250px; line-height: 1.25; display: none;
      }
      #ocean-loc-badge .b-loc { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 600; color: #eaf7fd; white-space: nowrap; }
      /* Region min→max stays in the Ocean Data panel (kept out of the badge so the
         badge is a compact single line that sits clear of the top-right toolbar). */
      #ocean-loc-badge .b-region { display: none; }
      #globe-return {
        background: rgba(56,189,248,0.16); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.4);
        border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer;
        white-space: nowrap; transition: background 0.14s, color 0.14s;
      }
      #globe-return:hover { background: rgba(56,189,248,0.3); color: #fff; }
    `;
    document.head.appendChild(s);
  }

  _build() {
    const hud = document.createElement('div');
    hud.id = 'globe-hud';
    hud.innerHTML = `
      <h2>🌍 Explore Earth</h2>
      <div class="g-note">Drag to rotate · scroll to zoom · click any ocean to select a location.</div>
      <div class="g-warn" id="globe-warn"></div>
      <div class="g-loc-l">Selected location</div>
      <div class="g-loc empty" id="globe-loc">Click an ocean to begin</div>
      <div class="g-sea" id="globe-sea"></div>
      <div class="g-region" id="globe-region"></div>
      <button id="globe-explore" disabled>Explore Ocean →</button>
      <div class="g-hint" id="globe-hint"></div>
    `;
    document.body.appendChild(hud);

    const badge = document.createElement('div');
    badge.id = 'ocean-loc-badge';
    badge.innerHTML = `
      <div class="b-stack">
        <span class="b-sea" id="ocean-sea-name"></span>
        <span class="b-loc" id="ocean-loc-text">📍 —</span>
        <span class="b-region" id="ocean-region-text"></span>
      </div>
      <button id="globe-return">← Return to Globe</button>
    `;
    document.body.appendChild(badge);

    this.hud = hud;
    this.badge = badge;
    this.locEl = hud.querySelector('#globe-loc');
    this.regionEl = hud.querySelector('#globe-region');
    this.seaEl = hud.querySelector('#globe-sea');
    this.exploreBtn = hud.querySelector('#globe-explore');
    this.warnEl = hud.querySelector('#globe-warn');
    this.hintEl = hud.querySelector('#globe-hint');
    this.badgeLocEl = badge.querySelector('#ocean-loc-text');
    this.badgeRegionEl = badge.querySelector('#ocean-region-text');
    this.badgeSeaEl = badge.querySelector('#ocean-sea-name');
    this.returnBtn = badge.querySelector('#globe-return');

    this.exploreBtn.onclick = () => { if (this._onExplore) this._onExplore(); };
    this.returnBtn.onclick = () => { if (this._onReturn) this._onReturn(); };
  }

  /** Legacy friendly format, e.g. "13.50° N, 86.00° E". */
  static format(loc) {
    if (!loc) return '—';
    const la = loc.latitude, lo = loc.longitude;
    const ns = la >= 0 ? 'N' : 'S', ew = lo >= 0 ? 'E' : 'W';
    return `${Math.abs(la).toFixed(2)}° ${ns}, ${Math.abs(lo).toFixed(2)}° ${ew}`;
  }

  /** The clicked point shown EXACTLY (signed, 3 dp): "Lat 12.160° | Lon 54.380°". */
  static formatLatLon(loc) {
    if (!loc) return '—';
    return `Lat ${loc.latitude.toFixed(3)}° | Lon ${loc.longitude.toFixed(3)}°`;
  }

  /** The query region: "Region  Lat 2.160°→22.160°  Lon 44.380°→64.380°". */
  static formatRegion(bbox) {
    if (!bbox) return '';
    return `Region  Lat ${bbox.latMin.toFixed(3)}°→${bbox.latMax.toFixed(3)}°   ` +
           `Lon ${bbox.lonMin.toFixed(3)}°→${bbox.lonMax.toFixed(3)}°`;
  }

  /**
   * Reflect the current selection (or null) in both surfaces. `bbox` is the
   * region derived from (and, in the ocean, sent for) this point — shown so the
   * user always sees the exact location AND the exact region being queried.
   */
  showLocation(loc, bbox = null) {
    this._loc = loc;
    this._bbox = bbox;
    if (loc) {
      this.setHint('');   // a valid ocean point was selected — clear any land prompt
      this.locEl.textContent = GlobeControls.formatLatLon(loc);
      this.locEl.classList.remove('empty');
      this.regionEl.textContent = GlobeControls.formatRegion(bbox);
      this.badgeLocEl.textContent = `📍 ${GlobeControls.formatLatLon(loc)}`;
      this.badgeRegionEl.textContent = GlobeControls.formatRegion(bbox);
    } else {
      this.locEl.textContent = 'Click an ocean to begin';
      this.locEl.classList.add('empty');
      this.regionEl.textContent = '';
      this.badgeLocEl.textContent = '📍 —';
      this.badgeRegionEl.textContent = '';
      this.setOceanRegionName(null);   // no point selected → no sea name
    }
    this.setExploreEnabled(!!loc);
  }

  /**
   * Show the authoritative sea/ocean name (from OceanRegions point-in-polygon) in
   * both surfaces — the globe preview and the ocean badge. Pass null/'' to clear.
   * This is REAL data only; when the point matches no named polygon the caller
   * passes null and the badge simply shows the coordinates without a name.
   */
  setOceanRegionName(name) {
    const n = name ? String(name) : '';
    if (this.badgeSeaEl) {
      this.badgeSeaEl.textContent = n;
      this.badgeSeaEl.style.display = n ? 'block' : 'none';
    }
    if (this.seaEl) {
      this.seaEl.textContent = n;
      this.seaEl.classList.toggle('show', !!n);
    }
  }

  setExploreEnabled(on) { this.exploreBtn.disabled = !on; }

  /**
   * Toggle which surface is shown. Ocean/globe chrome visibility is driven by
   * the body.globe-mode class (set in main.js); here we only manage the ocean
   * badge, which appears once a location exists and we are in the ocean.
   */
  setMode(mode) {
    this.badge.classList.toggle('show', mode === 'ocean' && !!this._loc);
  }

  /** Show/clear the placeholder warning when no Earth image is present. */
  setAssetMissing(on, msg) {
    this.warnEl.textContent = msg || '';
    this.warnEl.classList.toggle('show', !!on);
  }

  /**
   * Show/clear the "click an ocean" prompt (§1). Called when the user clicks a
   * LAND pixel: the globe stays put, no location is selected, and this message
   * asks for an ocean point. Cleared automatically on the next valid selection.
   */
  setHint(msg) {
    if (!this.hintEl) return;
    this.hintEl.textContent = msg || '';
    this.hintEl.classList.toggle('show', !!msg);
  }

  onExplore(cb) { this._onExplore = cb; }
  onReturn(cb) { this._onReturn = cb; }
}
