import { DataError } from './OceanDataService.js';
import { PALETTES, DEFAULT_PALETTE, rampRGB, ScientificColorScale } from './ModelFieldColor.js';
import { VEX_MIN, VEX_MAX, DEFAULT_OPACITY } from './ModelFieldLayer.js';
import { DEFAULT_OPACITY as ISO_DEFAULT_OPACITY } from './IsosurfaceLayer.js';
import {
  clampIndex, indexForIso, newestIndexForDay, formatModelTime,
  isoFromLocalInput, validateWindow, fieldCacheKey, BoundedFieldCache,
} from './ModelTimeAxis.js';

// Half-size (degrees) of the square observation region centred on a picked
// location. One definition, shared by the ocean query and the globe's region
// preview, so the displayed region can never silently differ from the one sent.
const REGION_HALF_DEG = 10;

/**
 * DataVizPanel — the scientific control surface for real ocean observations
 * (spec §32). Self-contained: injects its own launcher button + panel, so it
 * does not touch the existing UIManager. Orchestrates:
 *
 *   OceanDataService  → fetch catalog + observations + profiles
 *   ObservationLayer  → 3D markers (load / show / highlight)
 *   ObservationProfileViewer → depth-vs-variable chart on selection
 *
 * Selection is shared between clicking a marker in 3D and clicking a row in the
 * float list here, via selectByIndex(). Every failure is surfaced explicitly in
 * the status line — no data is ever fabricated (spec §33/§40).
 */
export class DataVizPanel {
  constructor({ service, layer, viewer, geoTransform, modelLayer = null, isoLayer = null, onFocus = null, onFieldRender = null, onFieldRecolor = null, deferStart = false } = {}) {
    this.service = service;
    this.layer = layer;
    this.viewer = viewer;
    this.geo = geoTransform;
    this.modelLayer = modelLayer;   // ModelFieldLayer (Phase 5) — rendering only
    this.isoLayer = isoLayer;       // IsosurfaceLayer (Phase 8) — rendering only
    this.onFocus = onFocus;
    // Optional observer fired after a real model field renders, with the actual
    // ModelField (real latitude[]/longitude[] axes). Used by the geographic inset
    // to draw the true field footprint — purely a display hook; never alters data.
    this.onFieldRender = onFieldRender;
    // Fired on a purely-visual recolour (palette / range / scale) — no field fetch
    // happens — so the geographic inset can redraw its 2D raster from the same
    // in-place-mutated colorScale. Display hook only; never alters scientific data.
    this.onFieldRecolor = onFieldRecolor;

    this.dataset = 'incois_argo_floats';
    this.datasets = [];
    this.observations = [];
    this._started = false;

    // Phase 5 gridded-field state. The selected gridded dataset is tracked
    // separately from the observation dataset so switching to a model dataset
    // does not disturb the Argo workflow. `_fieldGen` guards against a slow
    // request painting a stale field over a newer one (spec §11).
    this.modelDataset = null;
    this.modelAxes = null;          // { times:[], depths:[] } from getModelAxes
    this._fieldGen = 0;

    // Phase 7 (Time Dimension) state. `_timeIndex` is the ONE canonical selected
    // index into modelAxes.times[] — the Date/Time selects and the slider are all
    // views of it (via _setModelTimeIndex). `_fieldRendered` is the initial-render
    // gate: time controls only auto-fetch AFTER the user's first explicit render.
    // Playback is a setTimeout-chained stepper (never per-frame, never overlapping).
    // `_fieldCache` is a bounded LRU so re-selecting a real timestamp is zero-fetch.
    this._timeIndex = 0;
    this._fieldRendered = false;
    this._playing = false;
    this._speed = 1;                // playback speed multiplier only (never a timestamp)
    this._playTimer = null;
    this._sliderTimer = null;
    this._fieldCache = new BoundedFieldCache(8);

    // Phase 8 (Isosurface) state. The isosurface is an ADDITIONAL layer driven by a
    // REAL depth-resolved volume (getModelVolume) for the current dataset / variable /
    // canonical model time / bbox — NOT by the depth-slice selection (it spans all real
    // depths). `_isoValue` is the contour value in the field's real units, seeded from
    // the volume's REAL finite extent (never hardcoded). `_isoVolumeKey` records which
    // target the currently-held volume is for (depth EXCLUDED, so a depth-slice change
    // never refetches it); `_isoGen` guards against a slow volume response overwriting a
    // newer one (mirrors `_fieldGen`). `_isoMeshPresent` tracks whether a surface mesh
    // currently exists, so a re-enable rebuilds but a depth-only change stays a no-op.
    this._isoEnabled = false;
    this._isoValue = null;
    this._isoExtent = null;          // {min,max} real finite extent of the held volume
    this._isoUnits = '';
    this._isoVolumeKey = null;       // key of the volume the layer currently holds
    this._isoGen = 0;
    this._isoMeshPresent = false;
    this._isoSliderTimer = null;

    this._injectStyles();
    this._build();
    // In the globe flow the panel stays dormant until the user enters the ocean;
    // the catalog is only fetched then (start()). Standalone use starts now.
    if (!deferStart) this.start();
  }

  _injectStyles() {
    if (document.getElementById('dv-panel-style')) return;
    const s = document.createElement('style');
    s.id = 'dv-panel-style';
    s.textContent = `
      #dv-launch {
        position: fixed; top: 16px; left: 16px; z-index: 121;
        background: rgba(15,23,42,0.85); backdrop-filter: blur(12px);
        border: 1px solid rgba(56,189,248,0.35); color: #7dd3fc;
        padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
        cursor: pointer; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }
      #dv-launch:hover { background: rgba(56,189,248,0.25); border-color: #38bdf8; color: #fff; }
      #dv-launch.active { background: #0284c7; color: #fff; border-color: #38bdf8; }
      #dv-panel {
        position: fixed; top: 56px; left: 16px; z-index: 120;
        width: 312px; max-width: calc(100vw - 32px);
        /* Reserve the bottom ~320px of the viewport for the bottom-left Codex
           focus card so the Ocean Data panel can NEVER grow down over it. Long
           float lists scroll inside this capped height instead of overlapping. */
        max-height: calc(100vh - 376px); overflow-y: auto;
        background: rgba(10, 25, 41, 0.90);
        backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
        border: 1px solid rgba(56, 189, 248, 0.30); border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.6), inset 0 0 12px rgba(56,189,248,0.08);
        color: #e0f2fe; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 12px; padding: 12px 14px; display: none;
      }
      #dv-panel.open { display: block; }
      #dv-panel h3 { font-size: 13px; color: #7dd3fc; font-weight: 700; margin-bottom: 2px; }
      #dv-panel .dv-note { color: #64748b; font-size: 10px; line-height: 1.5; margin-bottom: 8px; }
      #dv-panel label.dv-l { display:block; color:#94a3b8; font-size:10.5px; text-transform:uppercase; letter-spacing:0.05em; margin:8px 0 3px; }
      #dv-panel select, #dv-panel input[type=number] {
        width: 100%; background: rgba(15,23,42,0.85); color: #e0f2fe;
        border: 1px solid rgba(56,189,248,0.3); border-radius: 7px; padding: 5px 8px; font-size: 12px;
      }
      #dv-panel .dv-bbox { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      #dv-panel .dv-bboxcap { margin-top: 0; margin-bottom: 3px; }
      #dv-panel .dv-bboxcap span { color:#64748b; font-size:9.5px; text-transform:uppercase; letter-spacing:0.04em; }
      #dv-panel .dv-selloc {
        margin-top: 2px; padding: 6px 8px; border-radius: 7px; font-size: 12px; font-weight: 700;
        color: #7dd3fc; background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.25);
      }
      #dv-panel .dv-selloc.empty { color:#64748b; font-weight:400; font-style:italic; background:transparent; border-color:rgba(148,163,184,0.15); }
      #dv-panel #dv-region { margin-top: 5px; color:#94a3b8; font-size:10px; line-height:1.5; }
      #dv-panel .dv-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
      #dv-panel .dv-btn {
        flex: 1; background: #0284c7; color: #fff; border: 1px solid #38bdf8;
        border-radius: 8px; padding: 7px 10px; font-size: 12px; font-weight: 700; cursor: pointer;
      }
      #dv-panel .dv-btn:hover { background: #0ea5e9; }
      #dv-panel .dv-btn[disabled] { opacity: 0.5; cursor: default; }
      #dv-panel label.dv-chk { display:flex; align-items:center; gap:6px; color:#cbd5e1; font-size:11px; cursor:pointer; white-space:nowrap; }
      #dv-panel .dv-status { margin-top: 10px; font-size: 11px; line-height: 1.5; color: #cbd5e1; min-height: 16px; }
      #dv-panel .dv-status.err { color: #fca5a5; }
      #dv-panel .dv-status.ok { color: #86efac; }
      #dv-panel .dv-meta { margin-top: 6px; color: #64748b; font-size: 10px; line-height: 1.5; }
      #dv-panel .dv-list { margin-top: 8px; border-top: 1px solid rgba(148,163,184,0.15); }
      #dv-panel .dv-item {
        padding: 7px 6px; border-bottom: 1px solid rgba(148,163,184,0.10);
        cursor: pointer; border-radius: 6px; transition: background 0.12s;
      }
      #dv-panel .dv-item:hover { background: rgba(56,189,248,0.10); }
      #dv-panel .dv-item.active { background: rgba(56,189,248,0.20); }
      #dv-panel .dv-item .id { font-weight: 700; color: #e0f2fe; }
      #dv-panel .dv-item .sub { color: #94a3b8; font-size: 10.5px; }
      /* Phase 5 gridded-field section — hidden unless a model dataset is active. */
      #dv-field { display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(148,163,184,0.15); }
      #dv-field.show { display: block; }
      #dv-field .dv-fieldgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      #dv-field .dv-fnote { color:#64748b; font-size:10px; line-height:1.5; margin:6px 0 0; }
      #dv-field .dv-fstatus { margin-top: 8px; font-size: 11px; line-height: 1.5; color: #cbd5e1; min-height: 14px; }
      #dv-field .dv-fstatus.err { color: #fca5a5; }
      #dv-field .dv-fstatus.ok { color: #86efac; }
      #dv-field .dv-fstatus.load { color: #7dd3fc; }
      #dv-field .dv-frow { display:flex; align-items:center; gap:8px; margin-top:8px; }
      #dv-field .dv-frow .dv-l { margin:0; flex:0 0 auto; min-width:64px; }
      #dv-field input[type=range] { flex:1; accent-color:#38bdf8; }
      #dv-field .dv-vexval { flex:0 0 auto; min-width:34px; text-align:right; color:#cbd5e1; font-size:11px; }
      #dv-field .dv-minmax { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; align-items:end; margin-top:8px; }
      #dv-field .dv-minmax .dv-l { margin:0 0 3px; }
      #dv-field .dv-auto {
        background: rgba(15,23,42,0.85); color:#7dd3fc; border:1px solid rgba(56,189,248,0.35);
        border-radius:7px; padding:5px 10px; font-size:11px; font-weight:600; cursor:pointer; height:29px;
      }
      #dv-field .dv-auto:hover { background: rgba(56,189,248,0.2); color:#fff; }
      /* Phase 7 — MODEL TIME block (transport + slider + big date/time readout).
         Extends the existing field section; no redesign of the panel. */
      #dv-mtime-block { margin-top: 10px; }
      #dv-mtime {
        display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 10px;
        padding:7px 9px; border-radius:8px; margin:2px 0 6px;
        background: rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.22);
      }
      #dv-mtime .dv-mtime-dt { font-size:14px; font-weight:700; color:#e0f2fe; }
      #dv-mtime .dv-mtime-tm { font-size:12px; font-weight:600; color:#7dd3fc; }
      #dv-mtime .dv-mtime-ix { font-size:10px; color:#64748b; margin-left:auto; }
      #dv-field .dv-transport { display:flex; gap:6px; margin-top:6px; }
      #dv-field .dv-tbtn {
        flex:1; background: rgba(15,23,42,0.85); color:#7dd3fc;
        border:1px solid rgba(56,189,248,0.35); border-radius:7px;
        padding:6px 8px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;
      }
      #dv-field .dv-tbtn:hover:not([disabled]) { background: rgba(56,189,248,0.2); color:#fff; }
      #dv-field .dv-tbtn[disabled] { opacity:0.4; cursor:default; }
      #dv-field .dv-tbtn.dv-play.playing { background:#0284c7; color:#fff; border-color:#38bdf8; }
      #dv-field #dv-mtime-slider { width:100%; accent-color:#38bdf8; margin-top:8px; }
      #dv-panel input[type=datetime-local] {
        width:100%; background: rgba(15,23,42,0.85); color:#e0f2fe; color-scheme: dark;
        border:1px solid rgba(56,189,248,0.3); border-radius:7px; padding:5px 8px; font-size:11px;
      }
      /* Scientific colorbar: variable/units caption, palette-driven gradient bar,
         numeric tick labels positioned at each tick's mapped fraction. */
      #dv-field .dv-cbar { margin-top: 10px; }
      #dv-field .dv-cbar .cap { font-size:10.5px; color:#94a3b8; margin-bottom:4px; }
      #dv-field .dv-cbar .cap b { color:#e0f2fe; }
      #dv-field .dv-cbar .barwrap { position:relative; }
      #dv-field .dv-cbar canvas { width:100%; height:12px; display:block; border-radius:4px; border:1px solid rgba(148,163,184,0.25); }
      #dv-field .dv-cbar .ticks { position:relative; height:14px; margin-top:2px; }
      #dv-field .dv-cbar .ticks span {
        position:absolute; transform:translateX(-50%); font-size:9px; color:#94a3b8; white-space:nowrap;
      }
      #dv-field .dv-cbar .ticks span:first-child { transform:translateX(0); }
      #dv-field .dv-cbar .ticks span:last-child { transform:translateX(-100%); }
      /* Phase 8 — 3D isosurface sub-section (an ADDITIONAL layer; its inner rows
         reuse the existing #dv-field / #dv-panel control styles). Shares the depth
         slice's colour scale + vertical exaggeration; has its own enable + opacity. */
      #dv-iso { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(148,163,184,0.15); }
      #dv-iso h3 { font-size: 13px; color: #7dd3fc; font-weight: 700; margin-bottom: 2px; }
    `;
    document.head.appendChild(s);
  }

  _build() {
    const launch = document.createElement('button');
    launch.id = 'dv-launch';
    launch.textContent = '🛰 Ocean Data';
    document.body.appendChild(launch);
    this.launch = launch;

    const panel = document.createElement('div');
    panel.id = 'dv-panel';
    panel.innerHTML = `
      <h3>Ocean Data — Observations</h3>
      <div class="dv-note">Real in-situ profiles from live sources. No values are synthesized.</div>

      <label class="dv-l">Dataset</label>
      <select id="dv-dataset"></select>
      <div class="dv-meta" id="dv-meta"></div>

      <label class="dv-l">Selected Location (Lat / Lon)</label>
      <div class="dv-selloc empty" id="dv-selloc">No location selected — pick a point on the globe.</div>

      <label class="dv-l">Region / Bounding Box (Lat min→max, Lon min→max)</label>
      <div class="dv-bbox dv-bboxcap">
        <span>Lat min</span><span>Lat max</span>
        <span>Lon min</span><span>Lon max</span>
      </div>
      <div class="dv-bbox">
        <input type="number" id="dv-latMin" step="0.5" title="latitude min">
        <input type="number" id="dv-latMax" step="0.5" title="latitude max">
        <input type="number" id="dv-lonMin" step="0.5" title="longitude min">
        <input type="number" id="dv-lonMax" step="0.5" title="longitude max">
      </div>
      <div id="dv-region"></div>

      <label class="dv-l">Max floats</label>
      <input type="number" id="dv-limit" step="50" min="1" max="5000">

      <label class="dv-l">Observation Time Window (UTC) — optional</label>
      <div class="dv-bbox dv-bboxcap"><span>From</span><span>To</span></div>
      <div class="dv-bbox">
        <input type="datetime-local" id="dv-ostart" title="observations from (UTC)">
        <input type="datetime-local" id="dv-oend" title="observations to (UTC)">
      </div>

      <div class="dv-row">
        <button class="dv-btn" id="dv-load">Load floats</button>
      </div>
      <div class="dv-row">
        <label class="dv-chk"><input type="checkbox" id="dv-showmarkers" checked> Show markers</label>
        <label class="dv-chk"><input type="checkbox" id="dv-focus"> Focus camera on selection</label>
      </div>

      <div class="dv-status" id="dv-status">Ready.</div>
      <div class="dv-list" id="dv-list"></div>

      <div id="dv-field">
        <h3>Gridded Field — Depth Slice</h3>
        <div class="dv-fnote" id="dv-field-prov">Real gridded field (server-side subset). No values are synthesized.</div>
        <div class="dv-fieldgrid">
          <div>
            <label class="dv-l">Variable</label>
            <select id="dv-fvar"></select>
          </div>
          <div>
            <label class="dv-l">Depth (m)</label>
            <select id="dv-fdepth"></select>
          </div>
        </div>
        <div class="dv-fieldgrid">
          <div>
            <label class="dv-l">Date</label>
            <select id="dv-fdate"></select>
          </div>
          <div>
            <label class="dv-l">Time (UTC)</label>
            <select id="dv-ftime"></select>
          </div>
        </div>
        <div class="dv-row">
          <button class="dv-btn" id="dv-fload">Render depth slice</button>
        </div>

        <div id="dv-mtime-block">
          <label class="dv-l">Model Time (UTC)</label>
          <div id="dv-mtime"><span class="dv-mtime-dt">—</span></div>
          <div class="dv-transport">
            <button class="dv-tbtn" id="dv-mprev" title="Previous timestep" disabled>◀ Prev</button>
            <button class="dv-tbtn" id="dv-mnext" title="Next timestep" disabled>Next ▶</button>
            <button class="dv-tbtn dv-play" id="dv-mplay" title="Play through real timesteps" disabled>▶ Play</button>
          </div>
          <input type="range" id="dv-mtime-slider" min="0" max="0" step="1" value="0" disabled title="Scrub the real model time axis">
          <div class="dv-frow">
            <label class="dv-l">Speed</label>
            <select id="dv-mspeed">
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
            </select>
          </div>
        </div>

        <div class="dv-fieldgrid">
          <div>
            <label class="dv-l">Palette</label>
            <select id="dv-fpalette"></select>
          </div>
          <div>
            <label class="dv-l">Scale</label>
            <select id="dv-fscale">
              <option value="linear">Linear</option>
              <option value="log">Log₁₀</option>
            </select>
          </div>
        </div>

        <div class="dv-minmax">
          <div>
            <label class="dv-l">Color min</label>
            <input type="number" id="dv-fmin" step="any" title="colour range minimum">
          </div>
          <div>
            <label class="dv-l">Color max</label>
            <input type="number" id="dv-fmax" step="any" title="colour range maximum">
          </div>
          <button class="dv-auto" id="dv-fauto" title="Reset to the current field's finite data range">Auto</button>
        </div>

        <div class="dv-frow">
          <label class="dv-l">Opacity</label>
          <input type="range" id="dv-fopacity" min="0" max="1" step="0.01">
        </div>
        <div class="dv-frow">
          <label class="dv-l">Depth ×</label>
          <input type="range" id="dv-fvex" min="1" max="20" step="0.5">
          <span class="dv-vexval" id="dv-fvexval">1×</span>
        </div>

        <div class="dv-cbar" id="dv-cbar" style="display:none">
          <div class="cap" id="dv-cbar-cap"></div>
          <div class="barwrap"><canvas id="dv-cbar-canvas" width="256" height="12"></canvas></div>
          <div class="ticks" id="dv-cbar-ticks"></div>
        </div>

        <div class="dv-row">
          <label class="dv-chk"><input type="checkbox" id="dv-fshow" checked> Show field layer</label>
        </div>
        <div class="dv-fstatus" id="dv-fstatus"></div>

        <div id="dv-iso">
          <h3>3D Isosurface</h3>
          <div class="dv-fnote">A real surface of constant value through the water column, extracted from the same real gridded field across all its real depths. No values are synthesized; missing data leaves real holes.</div>
          <div class="dv-row">
            <label class="dv-chk"><input type="checkbox" id="dv-isoenable"> Enable isosurface</label>
          </div>
          <div class="dv-frow">
            <label class="dv-l" id="dv-isoval-l">Isovalue</label>
            <input type="range" id="dv-isoval" min="0" max="1" step="any" value="0" disabled title="Contour value in the field's real units">
            <span class="dv-vexval" id="dv-isovalval">—</span>
          </div>
          <div class="dv-fnote" id="dv-isorange"></div>
          <div class="dv-frow">
            <label class="dv-l">Opacity</label>
            <input type="range" id="dv-isoopacity" min="0" max="1" step="0.01" disabled>
          </div>
          <div class="dv-fstatus" id="dv-isostatus"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;

    // Defaults from the geo transform bounds (Indian EEZ).
    const b = this.geo.bounds;
    panel.querySelector('#dv-latMin').value = b.latMin;
    panel.querySelector('#dv-latMax').value = b.latMax;
    panel.querySelector('#dv-lonMin').value = b.lonMin;
    panel.querySelector('#dv-lonMax').value = b.lonMax;
    panel.querySelector('#dv-limit').value = 200;

    launch.onclick = () => {
      const open = panel.classList.toggle('open');
      launch.classList.toggle('active', open);
    };
    panel.querySelector('#dv-dataset').onchange = (e) => {
      this.dataset = e.target.value;
      this._showDatasetMeta();
    };
    panel.querySelector('#dv-load').onclick = () => this._loadFloats();
    panel.querySelector('#dv-showmarkers').onchange = (e) => this.layer.setVisible(e.target.checked);

    // Gridded-field DATA-SELECTION controls (Phase 5) — these DO refetch.
    const fvar = panel.querySelector('#dv-fvar');
    const fdepth = panel.querySelector('#dv-fdepth');
    if (fvar) fvar.onchange = () => this._loadField();
    if (fdepth) fdepth.onchange = () => this._loadField();
    // Date / Time selects are VIEWS of the canonical _timeIndex (Phase 7). Changing
    // either resolves the EXACT real axis index and routes through _setModelTimeIndex,
    // whose refetch is GATED until the first explicit render.
    const fdate = panel.querySelector('#dv-fdate');
    if (fdate) fdate.onchange = () => {
      this._stopPlayback();
      this._populateFieldTimes(fdate.value);                 // refill this day's real times
      const idx = newestIndexForDay(this.modelAxes?.times || [], fdate.value);
      if (idx >= 0) this._setModelTimeIndex(idx, { refetch: true });
    };
    const ftime = panel.querySelector('#dv-ftime');
    if (ftime) ftime.onchange = () => {
      this._stopPlayback();
      const idx = indexForIso(this.modelAxes?.times || [], ftime.value);
      if (idx >= 0) this._setModelTimeIndex(idx, { refetch: true });
    };
    // "Render depth slice" is the primary FIRST-render trigger — ungated by design
    // (it calls _loadField directly and, on success, opens the time-scrubbing gate).
    const fload = panel.querySelector('#dv-fload');
    if (fload) fload.onclick = () => this._loadField();

    // MODEL TIME transport (Phase 7). Prev/Next clamp at the axis ends; the slider
    // syncs the display live but debounces the fetch to ONE request on settle; Play
    // is a sequential awaited stepper; Speed scales only the dwell, never a timestamp.
    const mprev = panel.querySelector('#dv-mprev');
    if (mprev) mprev.onclick = () => { this._stopPlayback(); this._setModelTimeIndex(this._timeIndex - 1, { refetch: true }); };
    const mnext = panel.querySelector('#dv-mnext');
    if (mnext) mnext.onclick = () => { this._stopPlayback(); this._setModelTimeIndex(this._timeIndex + 1, { refetch: true }); };
    const mplay = panel.querySelector('#dv-mplay');
    if (mplay) mplay.onclick = () => { if (this._playing) this._stopPlayback(); else this._startPlayback(); };
    const mslider = panel.querySelector('#dv-mtime-slider');
    if (mslider) {
      mslider.oninput = () => {
        this._stopPlayback();
        this._setModelTimeIndex(parseInt(mslider.value, 10), { refetch: false });   // live UI sync, no fetch per tick
        if (this._sliderTimer) clearTimeout(this._sliderTimer);
        this._sliderTimer = setTimeout(() => {                                       // one gated fetch on settle
          this._sliderTimer = null;
          if (this._fieldRendered) this._loadField();
          else if (this._isoEnabled) this._refreshIsosurface();                      // iso tracks time without a slice
        }, 200);
      };
      mslider.onchange = () => {                                                      // keyboard/step settle → immediate gated fetch
        if (this._sliderTimer) { clearTimeout(this._sliderTimer); this._sliderTimer = null; }
        if (this._fieldRendered) this._loadField();
        else if (this._isoEnabled) this._refreshIsosurface();
      };
    }
    const mspeed = panel.querySelector('#dv-mspeed');
    if (mspeed) mspeed.onchange = () => { this._speed = parseFloat(mspeed.value) || 1; };
    const fshow = panel.querySelector('#dv-fshow');
    if (fshow) fshow.onchange = (e) => { if (this.modelLayer) this.modelLayer.setVisible(e.target.checked); };

    // Phase 6 PURELY-VISUAL controls — recolour/opacity/exaggeration in place,
    // NEVER refetch the field (spec §12). Populate palette options first.
    const fpal = panel.querySelector('#dv-fpalette');
    if (fpal) {
      fpal.innerHTML = '';
      for (const [id, p] of Object.entries(PALETTES)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = p.name;
        fpal.appendChild(opt);
      }
      fpal.value = DEFAULT_PALETTE;
      fpal.onchange = () => this._applyVisual({ palette: fpal.value });
    }
    const fscale = panel.querySelector('#dv-fscale');
    if (fscale) fscale.onchange = () => this._applyVisual({ scale: fscale.value });
    const fmin = panel.querySelector('#dv-fmin');
    const fmax = panel.querySelector('#dv-fmax');
    if (fmin) fmin.onchange = () => this._applyManualRange();
    if (fmax) fmax.onchange = () => this._applyManualRange();
    const fauto = panel.querySelector('#dv-fauto');
    if (fauto) fauto.onclick = () => this._applyVisual({ manual: false });

    const fopacity = panel.querySelector('#dv-fopacity');
    if (fopacity) {
      fopacity.value = DEFAULT_OPACITY;
      fopacity.oninput = () => { if (this.modelLayer) this.modelLayer.setOpacity(parseFloat(fopacity.value)); };
    }
    const fvex = panel.querySelector('#dv-fvex');
    const fvexval = panel.querySelector('#dv-fvexval');
    if (fvex) {
      fvex.min = VEX_MIN; fvex.max = VEX_MAX; fvex.value = VEX_MIN;
      fvex.oninput = () => {
        const raw = parseFloat(fvex.value);
        const k = this.modelLayer ? this.modelLayer.setVerticalExaggeration(raw) : raw;
        // ONE vertical-exaggeration slider drives BOTH real layers. Each applies it
        // through its own group.scale.y (never the shared GeoTransform), so the slice
        // and the isosurface move together, the Argo markers stay put, and no geometry
        // is rebuilt (a pure transform change).
        this.isoLayer?.setVerticalExaggeration(raw);
        if (fvexval) fvexval.textContent = `${k}×`;
      };
    }

    // Phase 8 — Isosurface controls (an ADDITIONAL layer). Enable fetches the REAL
    // depth-resolved volume for the current target and contours it. The isovalue slider
    // re-meshes from the HELD volume only (no refetch), debounced so a drag fires one
    // re-mesh on settle. Opacity is this layer's own; vertical exaggeration is the shared
    // #dv-fvex slider above.
    const isoEnable = panel.querySelector('#dv-isoenable');
    if (isoEnable) isoEnable.onchange = (e) => this._setIsoEnabled(e.target.checked);
    const isoVal = panel.querySelector('#dv-isoval');
    if (isoVal) {
      isoVal.oninput = () => {
        this._isoValue = parseFloat(isoVal.value);
        this._updateIsoValueReadout();
        if (this._isoSliderTimer) clearTimeout(this._isoSliderTimer);
        this._isoSliderTimer = setTimeout(() => { this._isoSliderTimer = null; this._rebuildIsosurface(); }, 90);
      };
      isoVal.onchange = () => {                                    // keyboard/step settle → immediate re-mesh
        if (this._isoSliderTimer) { clearTimeout(this._isoSliderTimer); this._isoSliderTimer = null; }
        this._isoValue = parseFloat(isoVal.value);
        this._updateIsoValueReadout();
        this._rebuildIsosurface();
      };
    }
    const isoOpacity = panel.querySelector('#dv-isoopacity');
    if (isoOpacity) {
      isoOpacity.value = ISO_DEFAULT_OPACITY;
      isoOpacity.oninput = () => this.isoLayer?.setOpacity(parseFloat(isoOpacity.value));
    }
  }

  /**
   * Open the panel and load the dataset catalog — once. Called on first ocean
   * entry in the globe flow (deferStart), or immediately in standalone use.
   */
  start() {
    this._openPanel();
    if (this._started) return;
    this._started = true;
    this._loadCatalog();
  }

  _openPanel() {
    this.panel.classList.add('open');
    this.launch.classList.add('active');
  }

  /**
   * Compute the square observation region (bounding box, °) centred on a picked
   * geographic point. Single definition of "location → region" so the globe's
   * preview and the actual query can never diverge.
   * @param {{latitude:number, longitude:number}} loc
   * @param {number} [halfDeg]
   */
  static regionFor(loc, halfDeg = REGION_HALF_DEG) {
    return {
      latMin: Math.max(-90, loc.latitude - halfDeg),
      latMax: Math.min(90, loc.latitude + halfDeg),
      lonMin: Math.max(-180, loc.longitude - halfDeg),
      lonMax: Math.min(180, loc.longitude + halfDeg),
    };
  }

  /**
   * Centre the observation region on a picked geographic location and load the
   * real floats for it. This is the single "location → region" hook the globe
   * flow calls; it reuses the panel's own bbox + _loadFloats logic so there is
   * no duplicated coordinate handling. Returns the exact region (read back from
   * the inputs) that is sent to the backend, so callers can display that same
   * region — the clicked point is never moved and the region is never silently
   * different from what is queried.
   * @param {{latitude:number, longitude:number}} loc
   * @param {number} [halfDeg] half-size of the square region in degrees
   * @returns {{latMin:number,latMax:number,lonMin:number,lonMax:number}|null}
   */
  applySelectedLocation(loc, halfDeg = REGION_HALF_DEG) {
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
    const bbox = DataVizPanel.regionFor(loc, halfDeg);
    // Fill at full click precision so the displayed region is identical to what
    // _loadFloats reads back and sends — no silent rounding drift.
    this.panel.querySelector('#dv-latMin').value = bbox.latMin.toFixed(3);
    this.panel.querySelector('#dv-latMax').value = bbox.latMax.toFixed(3);
    this.panel.querySelector('#dv-lonMin').value = bbox.lonMin.toFixed(3);
    this.panel.querySelector('#dv-lonMax').value = bbox.lonMax.toFixed(3);
    // The region actually queried is whatever the inputs now hold; read it back
    // so the caller displays the exact same numbers (single source of truth).
    const sentBbox = this._readBbox();
    this.selectedPoint = { latitude: loc.latitude, longitude: loc.longitude };
    this.selectedBbox = sentBbox;
    this._updateLocationReadout();  // show the picked point + region immediately
    this.geo.setBounds(sentBbox);   // centre the ocean on the point immediately
    this.start();                   // ensure catalog + panel are up (idempotent)
    this._loadFloats();             // load real INCOIS Argo for this region
    return sentBbox;
  }

  _status(msg, cls = '') {
    const el = this.panel.querySelector('#dv-status');
    el.textContent = msg;
    el.className = 'dv-status' + (cls ? ' ' + cls : '');
  }

  async _loadCatalog() {
    this._status('Loading catalog…');
    let list;
    try {
      list = await this.service.listDatasets();
    } catch (e) {
      // The default adapter id still lets the user try loading; surface the error.
      if (e.status === 503 || e.isUpstreamUnavailable) {
        this._show503Error();
      } else {
        this._status(e instanceof DataError ? e.toDisplay() : String(e), 'err');
      }
      this._fillDatasetSelect([{ datasetId: this.dataset, name: this.dataset, status: 'unknown' }]);
      return;
    }
    this.datasets = list || [];
    // Prefer observation datasets; keep others visible too.
    const sorted = [...this.datasets].sort((a, b) =>
      (a.kind === 'observation' ? 0 : 1) - (b.kind === 'observation' ? 0 : 1));
    this._fillDatasetSelect(sorted);
    const has = sorted.find((d) => d.datasetId === this.dataset);
    if (!has && sorted.length) this.dataset = sorted[0].datasetId;
    this.panel.querySelector('#dv-dataset').value = this.dataset;
    this._showDatasetMeta();
    this._status('Catalog loaded. Choose a region and load floats.', 'ok');
  }

  _fillDatasetSelect(list) {
    const sel = this.panel.querySelector('#dv-dataset');
    sel.innerHTML = '';
    for (const d of list) {
      const opt = document.createElement('option');
      opt.value = d.datasetId;
      const status = d.status && d.status !== 'online' ? ` [${d.status}]` : '';
      opt.textContent = `${d.name || d.datasetId}${status}`;
      sel.appendChild(opt);
    }
    sel.value = this.dataset;
  }

  _showDatasetMeta() {
    const d = this.datasets.find((x) => x.datasetId === this.dataset);
    const el = this.panel.querySelector('#dv-meta');
    if (!d) { el.textContent = ''; this._syncFieldSection(null); return; }
    const t = Array.isArray(d.timeRange) && d.timeRange.length === 2
      ? `${d.timeRange[0].slice(0, 10)} … ${d.timeRange[1].slice(0, 10)}` : '—';
    const nv = Array.isArray(d.variables) ? d.variables.length : 0;
    el.innerHTML = `source: ${d.source || '—'} · ${d.fmt || ''}<br>time: ${t} · ${nv} variables · status: ${d.status || '—'}`;
    this._syncFieldSection(d);
  }

  // ---------------------------------------------------------------------------
  //  Phase 5 — gridded model/analysis field (depth slice).
  //  The field section is shown ONLY when the active dataset is a gridded
  //  ("model") dataset that is online. Variables come from the dataset's REAL
  //  metadata; depths + times come from the REAL axes (getModelAxes). Nothing is
  //  hardcoded or invented; rendering is delegated to ModelFieldLayer.
  // ---------------------------------------------------------------------------
  _syncFieldSection(d) {
    const sec = this.panel.querySelector('#dv-field');
    if (!sec || !this.modelLayer) return;
    const isModel = !!d && d.kind === 'model' && (d.status === 'online' || d.status === undefined);
    // Observation controls are only meaningful for observation datasets; the
    // field controls only for model datasets. Show the relevant set.
    const obsRow = this.panel.querySelector('#dv-load');
    if (!isModel) {
      sec.classList.remove('show');
      // Leaving a model dataset: drop any rendered slice so it can't linger over
      // an unrelated dataset's view.
      if (this.modelDataset && (!d || d.datasetId !== this.modelDataset)) {
        this.modelLayer.clear();
        this.onFieldRender?.(null);   // clear the geo-inset raster + footprint too
        this.modelDataset = null;
        this.modelAxes = null;
        this._resetModelTimeState();   // Phase 7: drop time index, gate, cache, playback
        const cbar = this.panel.querySelector('#dv-cbar');
        if (cbar) cbar.style.display = 'none';
      }
      if (obsRow) obsRow.parentElement.style.display = '';
      return;
    }
    sec.classList.add('show');
    if (obsRow) obsRow.parentElement.style.display = 'none';  // hide "Load floats" for a grid
    // Provenance line — surface the real product type so a gridded ANALYSIS is
    // never mistaken for a numerical model.
    const prov = this.panel.querySelector('#dv-field-prov');
    if (prov) {
      prov.textContent = `${d.name || d.datasetId} — ${d.fmt || 'gridded'}. `
        + 'Real server-side subset; missing cells are left empty. No values are synthesized.';
    }
    this._populateFieldVariables(d);
    // Load the real axes once per model dataset.
    if (this.modelDataset !== d.datasetId) {
      this.modelDataset = d.datasetId;
      this.modelAxes = null;
      this._resetModelTimeState();   // Phase 7: each model dataset needs its own first render
      this._loadFieldAxes(d.datasetId);
    }
  }

  _populateFieldVariables(d) {
    const sel = this.panel.querySelector('#dv-fvar');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    // Only variables the dataset actually advertises (real metadata). Phase 5
    // renders scalar fields; U/V current vectors are a later phase, so they are
    // not offered here even if a future dataset exposes them.
    const vars = (Array.isArray(d.variables) ? d.variables : [])
      .map((v) => (typeof v === 'string' ? { name: v } : v))
      .filter((v) => v && v.name);
    for (const v of vars) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.units ? `${v.name} (${v.units})` : v.name;
      sel.appendChild(opt);
    }
    if (prev && vars.some((v) => v.name === prev)) sel.value = prev;
  }

  async _loadFieldAxes(datasetId) {
    const status = this.panel.querySelector('#dv-fstatus');
    const fdepth = this.panel.querySelector('#dv-fdepth');
    if (status) { status.textContent = 'Loading depth/time axes…'; status.className = 'dv-fstatus load'; }
    let axes;
    try {
      axes = await this.service.getModelAxes(datasetId);
    } catch (e) {
      if (status) { status.textContent = e instanceof DataError ? e.toDisplay() : String(e); status.className = 'dv-fstatus err'; }
      return;
    }
    // A newer dataset selection may have superseded this fetch.
    if (this.modelDataset !== datasetId) return;
    this.modelAxes = axes || { times: [], depths: [] };

    // Depths — the REAL depth axis (metres), shallow→deep.
    if (fdepth) {
      fdepth.innerHTML = '';
      for (const z of this.modelAxes.depths || []) {
        const opt = document.createElement('option');
        opt.value = String(z);
        opt.textContent = `${z} m`;
        fdepth.appendChild(opt);
      }
    }
    // Dates + times — split from the REAL time axis (no fabrication). The Date
    // selector lists each unique calendar day present in the axis (newest first);
    // the Time selector lists the real steps available FOR the selected day. The
    // #dv-ftime option VALUE is a verbatim times[] entry, so _loadField sends an
    // exact real timestamp and never reconstructs or invents one.
    const fdate = this.panel.querySelector('#dv-fdate');
    if (fdate) {
      fdate.innerHTML = '';
      const seen = new Set();
      for (const t of [...(this.modelAxes.times || [])].reverse()) {
        const day = String(t).split('T')[0];
        if (seen.has(day)) continue;
        seen.add(day);
        const opt = document.createElement('option');
        opt.value = day;
        opt.textContent = day;
        fdate.appendChild(opt);
      }
      this._populateFieldTimes(fdate.value);
    }
    // Phase 7 — establish the ONE canonical selected time index (newest real step,
    // matching the app's newest-first default) and sync the MODEL TIME controls
    // (slider bounds/value, big date-time readout, Prev/Next/Play enablement) to it.
    // This is UI SYNC ONLY: the initial-render gate keeps `_fieldRendered` false, so
    // NO model field is fetched here — the user must press "Render depth slice" first.
    // Slider max derives from the REAL axis length (never a hardcoded step count).
    const times = this.modelAxes.times || [];
    this._timeIndex = times.length ? times.length - 1 : 0;
    const mslider = this.panel.querySelector('#dv-mtime-slider');
    if (mslider) {
      mslider.min = '0';
      mslider.max = String(Math.max(0, times.length - 1));
      mslider.step = '1';
      mslider.value = String(this._timeIndex);
    }
    if (times.length) this._setModelTimeIndex(this._timeIndex, { refetch: false });
    else { this._updateModelTimeDisplay(null); this._updatePlaybackButtons(); }
    const nd = (this.modelAxes.depths || []).length;
    const nt = (this.modelAxes.times || []).length;
    if (status) {
      status.textContent = `Axes loaded: ${nd} depth levels, ${nt} time steps. Choose variable/depth and render.`;
      status.className = 'dv-fstatus ok';
    }
  }

  /**
   * Fill the Time selector with the REAL time steps available for `dateStr`
   * (newest first). Each option's VALUE is the exact ISO string from the real
   * model time axis — so _loadField sends a verbatim axis entry and never
   * reconstructs or invents a timestamp. Selection-only; never fetches.
   */
  _populateFieldTimes(dateStr) {
    const ftime = this.panel.querySelector('#dv-ftime');
    if (!ftime) return;
    ftime.innerHTML = '';
    for (const t of [...(this.modelAxes?.times || [])].reverse()) {
      const s = String(t);
      if (dateStr && s.split('T')[0] !== dateStr) continue;
      const opt = document.createElement('option');
      opt.value = s;                                    // full ISO — a real axis entry
      const timePart = s.includes('T') ? s.split('T')[1].replace('Z', '') : s;
      opt.textContent = timePart || s;
      ftime.appendChild(opt);
    }
  }

  /**
   * Fetch the real subset for the current variable/depth/time/bbox and hand it to
   * the ModelFieldLayer. The selected time is ALWAYS the exact canonical axis entry
   * `modelAxes.times[_timeIndex]` (never reconstructed or nearest-matched here).
   * Guards against stale responses (spec §11); a bounded LRU makes re-selection
   * zero-fetch (Parts 24/26); on failure the PREVIOUS field is KEPT (Part 11) and
   * the honest error is shown — synthetic data is never substituted. A successful
   * render opens the initial-render gate so time-scrubbing may then auto-fetch.
   */
  async _loadField() {
    if (!this.modelLayer || !this.modelDataset) return;
    const status = this.panel.querySelector('#dv-fstatus');
    const btn = this.panel.querySelector('#dv-fload');
    const variable = this.panel.querySelector('#dv-fvar').value;
    const depthRaw = this.panel.querySelector('#dv-fdepth').value;
    // Canonical selected time — a verbatim modelAxes.times[] entry, or null if no
    // axis is loaded. NEVER read from the raw select text or approximated.
    const times = this.modelAxes?.times || [];
    const time = times.length ? times[clampIndex(this._timeIndex, times.length)] : null;
    if (!variable) {
      if (status) { status.textContent = 'Choose a variable.'; status.className = 'dv-fstatus err'; }
      return;
    }
    const depth = depthRaw === '' ? null : parseFloat(depthRaw);
    const bbox = this._readBbox();
    // Keep the transform bounds aligned with the queried region so the slice
    // sits where the rest of the scene expects (same rule the float loader uses).
    this.geo.setBounds(bbox);

    // Bounded LRU (Parts 24/26): key includes dataset/variable/depth/exact time/bbox.
    // A hit re-selects the same real field synchronously — no network — so same-time
    // re-render and small back-and-forth scrubbing are free. Purely-visual controls
    // never call _loadField, so they stay zero-fetch by construction.
    const cacheKey = fieldCacheKey({ dataset: this.modelDataset, variable, depth, time, bbox });
    const cached = this._fieldCache.get(cacheKey);
    if (cached) {
      const info = this.modelLayer.setField(cached);
      this._syncFieldControls(cached, info);
      if (this.onFieldRender) { try { this.onFieldRender(cached, info); } catch (_) {} }
      this._fieldRendered = true;
      this._updatePlaybackButtons();
      if (status) this._setFieldStatus(status, cached, info, true);
      // Phase 8: keep the isosurface in step with the field. No-op if disabled, or if
      // the required volume (variable/time/bbox — depth-independent) is unchanged.
      this._refreshIsosurface();
      return;
    }

    const gen = ++this._fieldGen;
    if (btn) btn.disabled = true;
    if (status) {
      const f = formatModelTime(time);
      status.textContent = `Loading ${variable} @ ${depth ?? 'surface'} m — ${f.date} ${f.label}…`;
      status.className = 'dv-fstatus load';
    }
    try {
      const field = await this.service.getModelField({
        dataset: this.modelDataset, variable, depth, time, bbox,
      });
      // A newer request started while this was in flight — discard this result so
      // a stale field is never shown as the current selection (spec §11).
      if (gen !== this._fieldGen) return;
      const info = this.modelLayer.setField(field);
      this._fieldCache.set(cacheKey, field);
      this._syncFieldControls(field, info);
      // Notify the geographic inset of the REAL rendered footprint (field axes).
      if (this.onFieldRender) { try { this.onFieldRender(field, info); } catch (_) {} }
      this._fieldRendered = true;          // gate open: slider/prev/next/play may auto-fetch
      this._updatePlaybackButtons();
      if (status) this._setFieldStatus(status, field, info, false);
      this._refreshIsosurface();   // Phase 8: track the field (no-op if disabled / volume unchanged)
    } catch (e) {
      if (gen !== this._fieldGen) return;
      // Part 11: KEEP the previous field visible — do NOT clear to a blank slice and
      // never substitute synthetic data. Surface the honest error only, and stop any
      // playback so it can't keep advancing into a failing window.
      if (status) { status.textContent = e instanceof DataError ? e.toDisplay() : String(e); status.className = 'dv-fstatus err'; }
      if (this._playing) this._stopPlayback();
    } finally {
      if (gen === this._fieldGen && btn) btn.disabled = false;
    }
  }

  /** Compose the "Rendered …" status line for a real field (shared by fetch + cache). */
  _setFieldStatus(status, field, info, fromCache) {
    const missingNodes = info.nLat * info.nLon - info.renderedVertices;
    status.innerHTML =
      `Rendered ${info.variable} @ ${info.depth} m — ${info.nLat}×${info.nLon} grid, `
      + `${info.renderedCells} cells`
      + (missingNodes > 0 ? `, ${missingNodes} missing node${missingNodes === 1 ? '' : 's'} left empty` : '')
      + `.<br>range ${info.min.toFixed(2)}–${info.max.toFixed(2)} ${info.units || ''} · `
      + `time ${(field.time || '').replace('T', ' ').replace('Z', '')}`
      + (fromCache ? ' · cached' : '');
    status.className = 'dv-fstatus ok';
  }

  // ---------------------------------------------------------------------------
  //  Phase 7 — Time Dimension. The MODEL TIME controls (Date/Time selects, slider,
  //  Prev/Next, Play, speed) are all VIEWS of the single canonical `_timeIndex`.
  //  `_setModelTimeIndex` is the ONE mutator that keeps them in sync; its refetch is
  //  gated on `_fieldRendered` so nothing loads before the first explicit render.
  // ---------------------------------------------------------------------------

  /**
   * The single mutator for the canonical selected model time. Clamps `idx` into the
   * real axis, syncs the Date select, Time select, slider, big readout and transport
   * enablement, and — only when `refetch` AND the initial-render gate is open — loads
   * the exact real timestamp. Returns the _loadField promise when it fetches (so the
   * playback stepper can await it), otherwise undefined.
   */
  _setModelTimeIndex(idx, { refetch = false } = {}) {
    const times = this.modelAxes?.times || [];
    if (!times.length) return;
    idx = clampIndex(idx, times.length);
    this._timeIndex = idx;
    const iso = times[idx];                       // a REAL axis entry, never reconstructed
    const day = String(iso).split('T')[0];
    const fdate = this.panel.querySelector('#dv-fdate');
    const ftime = this.panel.querySelector('#dv-ftime');
    const slider = this.panel.querySelector('#dv-mtime-slider');
    if (fdate && fdate.value !== day) { fdate.value = day; this._populateFieldTimes(day); }
    if (ftime && ftime.value !== iso) ftime.value = iso;
    if (slider && slider.value !== String(idx)) slider.value = String(idx);
    this._updateModelTimeDisplay(iso);
    this._updatePlaybackButtons();
    if (refetch && this._fieldRendered) return this._loadField();
    // Gate still closed (no depth slice rendered yet), but the isosurface is an
    // independent layer: if it's on, let it follow the new time on its own. When the
    // gate is open, _loadField above already refreshes it — so this never double-runs.
    if (refetch && this._isoEnabled) this._refreshIsosurface();
    return undefined;
  }

  /** Paint the big MODEL TIME readout from a real ISO string (no Date, no TZ shift). */
  _updateModelTimeDisplay(iso) {
    const el = this.panel.querySelector('#dv-mtime');
    if (!el) return;
    const times = this.modelAxes?.times || [];
    if (!iso || !times.length) {
      el.innerHTML = '<span class="dv-mtime-dt">—</span>';
      return;
    }
    const f = formatModelTime(iso);
    el.innerHTML =
      `<span class="dv-mtime-dt">${f.date}</span>`
      + `<span class="dv-mtime-tm">${f.label}</span>`
      + `<span class="dv-mtime-ix">step ${this._timeIndex + 1} / ${times.length}</span>`;
  }

  /** Enable/disable + relabel the transport to reflect the axis and playback state. */
  _updatePlaybackButtons() {
    const n = (this.modelAxes?.times || []).length;
    const hasAxis = n > 0;
    const prev = this.panel.querySelector('#dv-mprev');
    const next = this.panel.querySelector('#dv-mnext');
    const play = this.panel.querySelector('#dv-mplay');
    const slider = this.panel.querySelector('#dv-mtime-slider');
    if (slider) { slider.disabled = !hasAxis; slider.max = String(Math.max(0, n - 1)); }
    if (prev) prev.disabled = !hasAxis || this._timeIndex <= 0;
    if (next) next.disabled = !hasAxis || this._timeIndex >= n - 1;   // disabled at newest
    if (play) {
      play.disabled = !hasAxis || n <= 1;
      play.textContent = this._playing ? '⏸ Pause' : '▶ Play';
      play.classList.toggle('playing', this._playing);
    }
  }

  /**
   * Start controlled sequential playback (Part 7). Requires the initial-render gate
   * to be open; if not, it does nothing but hint. Does not loop — if already at the
   * newest step there is nothing to play.
   */
  _startPlayback() {
    if (this._playing) return;
    const status = this.panel.querySelector('#dv-fstatus');
    if (!this._fieldRendered) {
      if (status) { status.textContent = 'Render a depth slice first, then press Play.'; status.className = 'dv-fstatus load'; }
      return;
    }
    const times = this.modelAxes?.times || [];
    if (times.length <= 1) return;
    if (this._timeIndex >= times.length - 1) {
      if (status) { status.textContent = 'Already at the newest timestep.'; status.className = 'dv-fstatus'; }
      return;
    }
    this._playing = true;
    this._updatePlaybackButtons();
    this._playStep();
  }

  /** Stop playback and cancel any pending step timer (idempotent). */
  _stopPlayback() {
    this._playing = false;
    if (this._playTimer) { clearTimeout(this._playTimer); this._playTimer = null; }
    this._updatePlaybackButtons();
  }

  /**
   * One playback step: advance to the next real timestep, AWAIT its fetch (so
   * requests never overlap), then schedule the next step after a speed-scaled dwell.
   * Stops automatically at the newest step (no loop-back). A failed fetch inside
   * _loadField already stops playback, so we re-check `_playing` after the await.
   */
  async _playStep() {
    if (!this._playing) return;
    const times = this.modelAxes?.times || [];
    const max = times.length - 1;
    if (this._timeIndex >= max) { this._stopPlayback(); return; }
    await this._setModelTimeIndex(this._timeIndex + 1, { refetch: true });
    if (!this._playing) return;                    // paused/stopped (or errored) during the await
    const BASE_STEP_MS = 1500;                     // ≈1.5 s/step at 1× (Part 8)
    this._playTimer = setTimeout(() => this._playStep(), BASE_STEP_MS / this._speed);
  }

  /**
   * Reset all Phase 7 model-time state. Called when the model dataset changes or is
   * left, so each model dataset again requires an explicit first render before
   * time-scrubbing auto-fetches, and no stale field is served from the cache.
   */
  _resetModelTimeState() {
    this._stopPlayback();
    this._timeIndex = 0;
    this._fieldRendered = false;
    this._fieldCache.clear();
    this._resetIsoState();   // Phase 8: the isosurface belongs to this dataset — drop it too
  }

  // ---------------------------------------------------------------------------
  //  Phase 8 — 3-D Isosurface. An ADDITIONAL real layer: a surface of constant
  //  value through the water column, extracted (marching cubes) from the SAME real
  //  gridded field the depth slice uses, across ALL its real depths. Nothing here
  //  synthesizes data — missing cells leave real holes; the isovalue range comes
  //  from the volume's ACTUAL finite extent; the hue comes from the SAME colour
  //  scale as the slice. Regeneration is event-driven (enable / isovalue / variable
  //  / timestep / region), never per-frame; the held volume is disposed on disable
  //  and dataset change. `_isoGen` guards against a slow volume response landing
  //  after a newer selection (mirrors `_fieldGen`).
  // ---------------------------------------------------------------------------

  /** Enable/disable checkbox handler: turn the layer on (and fetch its volume) or tear it down. */
  _setIsoEnabled(on) {
    this._isoEnabled = !!on;
    const opacity = this.panel.querySelector('#dv-isoopacity');
    if (this._isoEnabled) {
      if (opacity) opacity.disabled = false;
      this.isoLayer?.setVisible(true);
      this._refreshIsosurface();       // fetch (or reuse) the REAL volume, then contour it
    } else {
      if (this._isoSliderTimer) { clearTimeout(this._isoSliderTimer); this._isoSliderTimer = null; }
      ++this._isoGen;                  // cancel any in-flight volume fetch
      this.isoLayer?.clear();          // dispose mesh + free the held volume/typed arrays
      this.isoLayer?.setVisible(false);
      this._isoMeshPresent = false;
      this._isoVolumeKey = null;
      this._isoExtent = null;
      const slider = this.panel.querySelector('#dv-isoval');
      if (slider) slider.disabled = true;
      if (opacity) opacity.disabled = true;
      this._setIsoStatus(null);
    }
  }

  /**
   * Ensure the layer holds the REAL depth-resolved volume for the current target
   * (dataset / variable / canonical model time / bbox) and has a surface meshed.
   * Depth is DELIBERATELY excluded from the volume key: the isosurface spans the
   * whole real depth axis, so changing the depth-SLICE selection must never refetch
   * it. A slow response is discarded if a newer refresh (or a disable) supersedes it.
   * On fetch failure the previous surface is KEPT and the honest error is shown.
   */
  async _refreshIsosurface() {
    if (!this._isoEnabled || !this.isoLayer || !this.modelDataset) return;
    const variable = this.panel.querySelector('#dv-fvar')?.value || '';
    if (!variable) { this._setIsoStatus({ error: 'Choose a variable to contour.' }); return; }
    const times = this.modelAxes?.times || [];
    const time = times.length ? times[clampIndex(this._timeIndex, times.length)] : null;
    const bbox = this._readBbox();
    const key = fieldCacheKey({ dataset: this.modelDataset, variable, depth: 'volume', time, bbox });

    // Layer already holds exactly this volume — no network. Just make sure a mesh
    // exists (covers a re-enable that kept the volume, or a redundant refresh).
    if (key === this._isoVolumeKey && this.isoLayer.hasVolume()) {
      if (!this._isoMeshPresent) this._rebuildIsosurface();
      return;
    }

    const gen = ++this._isoGen;
    const status = this.panel.querySelector('#dv-isostatus');
    if (status) {
      const f = formatModelTime(time);
      status.textContent = `Loading ${variable} volume — ${f.date} ${f.label}…`;
      status.className = 'dv-fstatus load';
    }
    try {
      const volume = await this.service.getModelVolume({ dataset: this.modelDataset, variable, time, bbox });
      // A newer refresh (variable / time / region change) or a disable superseded this.
      if (gen !== this._isoGen || !this._isoEnabled) return;
      const summary = this.isoLayer.setVolume(volume);   // flattens ONCE; missing → NaN (holes)
      summary.depthUnits = volume.depthUnits || 'm';
      this._isoVolumeKey = key;
      this._isoUnits = summary.units || '';
      this._isoExtent = (Number.isFinite(summary.min) && Number.isFinite(summary.max))
        ? { min: summary.min, max: summary.max } : null;
      this._isoMeshPresent = false;
      this._syncIsoControls(summary);                    // seed slider from the REAL extent
      if (!summary.renderable || !this._isoExtent) {
        // A legitimate "no surface here" — never an invented one. Explain why.
        let reason;
        if (!this._isoExtent) reason = 'No finite values in this volume — nothing to contour.';
        else if (summary.nDepth < 2) reason = 'Only one real depth level in range — a 3-D surface needs ≥2.';
        else reason = 'Region too small in lat/lon to form a surface (need ≥2×2).';
        this._setIsoStatus({ empty: true, reason });
        return;
      }
      this._rebuildIsosurface();
    } catch (e) {
      if (gen !== this._isoGen) return;
      // Keep any existing surface — never blank a good one on a failed refresh. If the
      // failure was inside setVolume (the layer already cleared itself), reflect that.
      if (this.isoLayer && !this.isoLayer.hasVolume()) {
        this._isoMeshPresent = false; this._isoVolumeKey = null; this._isoExtent = null;
      }
      this._setIsoStatus({ error: e instanceof DataError ? e.toDisplay() : String(e) });
    }
  }

  /**
   * Re-mesh the surface from the HELD volume at the current isovalue (no refetch).
   * Called on enable, isovalue change and — via _refreshIsosurface after a new
   * volume — variable/time/region change. Old geometry/material are disposed inside
   * IsosurfaceLayer.rebuild before the new mesh is built.
   */
  _rebuildIsosurface() {
    if (!this._isoEnabled || !this.isoLayer || !this.isoLayer.hasVolume()) return;
    if (!Number.isFinite(this._isoValue)) return;
    const res = this.isoLayer.rebuild(this._isoValue, this._isoColorScale());
    this._isoMeshPresent = !!res && !res.empty;
    this._setIsoStatus(res);
  }

  /**
   * The colour scale for the constant-value surface. Prefer the EXACT instance the
   * depth slice / colorbar / Geo View use (ModelFieldLayer.colorScale) so the
   * isosurface's single hue matches them and tracks palette/range/scale changes for
   * free. Before any slice has rendered, build the SAME class seeded from the
   * volume's REAL finite extent and the currently-selected palette — same mapping,
   * real-data range, nothing invented.
   */
  _isoColorScale() {
    const shared = this.modelLayer?.colorScale;
    if (shared && typeof shared.colorFor === 'function') return shared;
    if (!this._isoExtent) return null;
    const pal = this.panel.querySelector('#dv-fpalette')?.value || DEFAULT_PALETTE;
    return new ScientificColorScale({
      min: this._isoExtent.min, max: this._isoExtent.max, palette: pal, scale: 'linear',
    });
  }

  /**
   * Seed the isovalue slider + range note from the REAL volume extent (never
   * hardcoded). The slider is enabled only when the volume can actually form a
   * surface; the current isovalue is kept if it still lies inside the real range,
   * else the midpoint of the ACTUAL extent is used.
   */
  _syncIsoControls(summary) {
    const slider = this.panel.querySelector('#dv-isoval');
    const label = this.panel.querySelector('#dv-isoval-l');
    const note = this.panel.querySelector('#dv-isorange');
    const units = summary.units || this._isoUnits || '';
    if (label) label.textContent = units ? `Isovalue (${units})` : 'Isovalue';

    const ext = this._isoExtent;
    const canContour = !!summary.renderable && !!ext
      && Number.isFinite(ext.min) && Number.isFinite(ext.max) && ext.max > ext.min;

    if (slider) {
      if (canContour) {
        slider.min = String(ext.min);
        slider.max = String(ext.max);
        slider.step = String(this._niceStep(ext.min, ext.max));
        slider.disabled = false;
        let v = this._isoValue;
        if (!Number.isFinite(v) || v < ext.min || v > ext.max) v = (ext.min + ext.max) / 2;
        this._isoValue = v;
        slider.value = String(v);
      } else {
        slider.disabled = true;
      }
    }
    this._updateIsoValueReadout();

    if (note) {
      if (ext && Number.isFinite(ext.min) && Number.isFinite(ext.max)) {
        const u = units ? ` ${units}` : '';
        const depthSpan = (summary.depthMin != null && summary.depthMax != null)
          ? ` · depths ${this._fmtNum(summary.depthMin)}–${this._fmtNum(summary.depthMax)} ${summary.depthUnits || 'm'}`
          : '';
        note.textContent =
          `Real Volume range ${this._fmtNum(ext.min)}–${this._fmtNum(ext.max)}${u}`
          + ` · ${summary.nLon}×${summary.nLat}×${summary.nDepth} grid${depthSpan}`;
      } else {
        note.textContent = '';
      }
    }
  }

  /** A tidy slider step (~200 positions across the real range), rounded to 1/2/5×10ⁿ. */
  _niceStep(min, max) {
    const span = Math.abs(max - min);
    if (!Number.isFinite(span) || span <= 0) return 'any';
    const raw = span / 200;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;                       // 1..10
    const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return nice * mag;
  }

  /** Update the isovalue readout chip (real value + units, or — when none). */
  _updateIsoValueReadout() {
    const el = this.panel.querySelector('#dv-isovalval');
    if (!el) return;
    if (!Number.isFinite(this._isoValue)) { el.textContent = '—'; return; }
    const u = this._isoUnits ? ` ${this._isoUnits}` : '';
    el.textContent = `${this._fmtNum(this._isoValue)}${u}`;
  }

  /**
   * Compose the isosurface status line. Accepts null (clear), an {error} object, an
   * {empty,reason} "no surface" result, or a rendered {isovalue,units,vertex/triangle
   * counts} result from IsosurfaceLayer.rebuild.
   */
  _setIsoStatus(res) {
    const status = this.panel.querySelector('#dv-isostatus');
    if (!status) return;
    if (!res) { status.textContent = ''; status.className = 'dv-fstatus'; return; }
    if (res.error) { status.textContent = res.error; status.className = 'dv-fstatus err'; return; }
    if (res.empty) {
      const u = this._isoUnits ? ` ${this._isoUnits}` : '';
      status.textContent = res.reason
        || (Number.isFinite(this._isoValue)
            ? `No surface at ${this._fmtNum(this._isoValue)}${u} — that value isn't crossed in this volume.`
            : 'No surface for this selection.');
      status.className = 'dv-fstatus';
      return;
    }
    const u = res.units ? ` ${res.units}` : '';
    status.innerHTML =
      `Isosurface at ${this._fmtNum(res.isovalue)}${u} — `
      + `${res.triangleCount.toLocaleString()} triangles, ${res.vertexCount.toLocaleString()} vertices.`;
    status.className = 'dv-fstatus ok';
  }

  /**
   * Full isosurface teardown for a dataset switch / leaving a model dataset: cancel
   * any pending work, dispose the mesh + volume, reset all state, and return the UI
   * to its disabled/blank defaults. Safe to call when isoLayer is absent.
   */
  _resetIsoState() {
    if (this._isoSliderTimer) { clearTimeout(this._isoSliderTimer); this._isoSliderTimer = null; }
    ++this._isoGen;                  // cancel any in-flight volume fetch
    this._isoEnabled = false;
    this._isoValue = null;
    this._isoExtent = null;
    this._isoUnits = '';
    this._isoVolumeKey = null;
    this._isoMeshPresent = false;
    this.isoLayer?.clear();
    this.isoLayer?.setVisible(false);
    const enable = this.panel?.querySelector('#dv-isoenable');
    const slider = this.panel?.querySelector('#dv-isoval');
    const opacity = this.panel?.querySelector('#dv-isoopacity');
    const label = this.panel?.querySelector('#dv-isoval-l');
    const note = this.panel?.querySelector('#dv-isorange');
    if (enable) enable.checked = false;
    if (slider) { slider.disabled = true; slider.min = '0'; slider.max = '1'; slider.step = 'any'; slider.value = '0'; }
    if (opacity) opacity.disabled = true;
    if (label) label.textContent = 'Isovalue';
    if (note) note.textContent = '';
    this._updateIsoValueReadout();   // now shows —
    this._setIsoStatus(null);
  }

  // ---------------------------------------------------------------------------
  //  Phase 6 — scientific colour controls + colorbar. All PURELY VISUAL: they
  //  recolour / restyle the already-loaded field in place and NEVER refetch
  //  (spec §12). The real ModelField values are never altered (spec §8).
  // ---------------------------------------------------------------------------

  /**
   * After a fresh field loads, seed the visual controls from its real extent
   * (unless the user has an explicit manual range active), (re)apply the
   * persisted palette/scale/opacity/exaggeration, and paint the colorbar.
   */
  _syncFieldControls(field, info) {
    this._fieldUnits = info.units || field.units || '';
    this._fieldTime = field.time || null;   // real ISO timestamp for the colorbar header
    const fmin = this.panel.querySelector('#dv-fmin');
    const fmax = this.panel.querySelector('#dv-fmax');
    // Seed min/max from the effective range the layer is actually using (auto,
    // or the user's manual override carried across the reload).
    if (fmin && document.activeElement !== fmin) fmin.value = this._fmtNum(info.min);
    if (fmax && document.activeElement !== fmax) fmax.value = this._fmtNum(info.max);
    // Log availability depends on THIS field's range; disable + revert if invalid.
    this._updateScaleAvailability(info.logValid, info.scale);
    this._drawColorbar(info);
  }

  _fmtNum(v) {
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(2);
    return String(Math.round(v * 1000) / 1000);
  }

  /** Format a real ISO timestamp as "YYYY-MM-DD · HH:MM UTC" for the colorbar. */
  _fmtWhen(iso) {
    if (!iso) return '';
    const s = String(iso);
    const [d, rest] = s.split('T');
    if (!rest) return d;
    return `${d} · ${rest.replace('Z', '').slice(0, 5)} UTC`;
  }

  _updateScaleAvailability(logValid, activeScale) {
    const fscale = this.panel.querySelector('#dv-fscale');
    if (!fscale) return;
    const logOpt = fscale.querySelector('option[value="log"]');
    if (logOpt) {
      logOpt.disabled = !logValid;
      logOpt.textContent = logValid ? 'Log₁₀' : 'Log₁₀ (needs >0)';
    }
    // The layer already reverts an invalid log request to linear; mirror that in
    // the selector so the UI never claims a mode that isn't in effect.
    fscale.value = activeScale || 'linear';
  }

  /**
   * Apply a purely-visual change (palette / scale / auto-reset). Delegates to
   * the layer's in-place recolour and repaints the colorbar. No refetch.
   */
  _applyVisual(opts) {
    if (!this.modelLayer) return;
    const state = this.modelLayer.applyColorScale(opts);
    if (!state) return;
    // Reflect the effective state back into the inputs (e.g. Auto refilled the
    // range; an invalid log reverted to linear).
    const fmin = this.panel.querySelector('#dv-fmin');
    const fmax = this.panel.querySelector('#dv-fmax');
    if (opts.manual === false) {
      if (fmin) fmin.value = this._fmtNum(state.min);
      if (fmax) fmax.value = this._fmtNum(state.max);
    }
    this._updateScaleAvailability(state.logValid, state.scale);
    this._drawColorbar({
      variable: this.panel.querySelector('#dv-fvar').value,
      units: this._fieldUnits, ...state,
    });
    // The same recolour reaches the geographic inset's 2D raster (still no refetch).
    this.onFieldRecolor?.();
    // ...and the isosurface (a constant-value surface) re-hues to match the slice's
    // new palette/range through the SAME shared scale — recolour only, no re-mesh.
    if (this._isoEnabled && this._isoMeshPresent) this.isoLayer?.applyColor(this._isoColorScale());
  }

  /**
   * Read the min/max inputs, validate (numeric, min<max), and apply as a manual
   * override. Invalid entries are rejected without touching the data.
   */
  _applyManualRange() {
    const fmin = this.panel.querySelector('#dv-fmin');
    const fmax = this.panel.querySelector('#dv-fmax');
    const min = parseFloat(fmin.value);
    const max = parseFloat(fmax.value);
    const status = this.panel.querySelector('#dv-fstatus');
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      if (status) { status.textContent = 'Color range must be numeric.'; status.className = 'dv-fstatus err'; }
      return;
    }
    if (min >= max) {
      if (status) { status.textContent = 'Color min must be less than max.'; status.className = 'dv-fstatus err'; }
      return;
    }
    this._applyVisual({ min, max, manual: true });
  }

  /**
   * Paint the scientific colorbar: a palette-driven gradient with the variable /
   * units caption and numeric tick labels positioned at each value's mapped
   * fraction (so log mode bunches ticks correctly). The endpoints reflect the
   * ACTIVE visualization range (auto or manual) — never a hardcoded range.
   */
  _drawColorbar(info) {
    const wrap = this.panel.querySelector('#dv-cbar');
    const canvas = this.panel.querySelector('#dv-cbar-canvas');
    const cap = this.panel.querySelector('#dv-cbar-cap');
    const ticks = this.panel.querySelector('#dv-cbar-ticks');
    if (!wrap || !canvas || !Number.isFinite(info.min) || !Number.isFinite(info.max)) {
      if (wrap) wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    const palette = PALETTES[info.palette] || PALETTES[DEFAULT_PALETTE];
    const stops = palette.stops;
    const isLog = info.scale === 'log';

    // Gradient: sample the palette left→right across the pixel width. This is
    // the colour ramp itself (t 0→1), independent of linear/log — the MAPPING of
    // data values onto t is what log changes, reflected by the tick positions.
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const img = ctx.createImageData(w, 1);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rampRGB(stops, x / (w - 1));
      const o = x * 4;
      img.data[o] = Math.round(r * 255);
      img.data[o + 1] = Math.round(g * 255);
      img.data[o + 2] = Math.round(b * 255);
      img.data[o + 3] = 255;
    }
    // Stretch the 1px-tall gradient over the canvas height.
    ctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, w, 1, 0, 0, w, canvas.height);

    const u = info.units || this._fieldUnits || '';
    const scaleLabel = isLog ? ' · log₁₀' : '';
    if (cap) {
      const when = this._fmtWhen(this._fieldTime);
      cap.innerHTML = `<b>${info.variable || 'field'}</b>${u ? ' (' + u + ')' : ''}${scaleLabel}`
        + (when ? `<br><span style="color:#7dd3fc;font-size:10px;letter-spacing:0.03em">${when}</span>` : '');
    }

    // Numeric ticks at their mapped fraction. Linear → evenly spaced; log →
    // geometric spacing so labels sit where the colour actually maps.
    if (ticks) {
      ticks.innerHTML = '';
      const N = 5;
      for (let k = 0; k < N; k++) {
        const f = k / (N - 1);           // 0..1 position along the bar
        let value;
        if (isLog && info.min > 0) {
          const lmin = Math.log10(info.min);
          const lmax = Math.log10(info.max);
          value = Math.pow(10, lmin + f * (lmax - lmin));
        } else {
          value = info.min + f * (info.max - info.min);
        }
        const span = document.createElement('span');
        span.style.left = `${f * 100}%`;
        span.textContent = this._fmtNum(value);
        ticks.appendChild(span);
      }
    }
  }

  _readBbox() {
    const num = (id) => {
      const v = parseFloat(this.panel.querySelector(id).value);
      return Number.isFinite(v) ? v : null;
    };
    return { latMin: num('#dv-latMin'), latMax: num('#dv-latMax'), lonMin: num('#dv-lonMin'), lonMax: num('#dv-lonMax') };
  }

  // Refresh the two explicit readouts (spec §1):
  //   SELECTED LOCATION — the single clicked point (lat/lon), never a box.
  //   REGION / BOUNDING BOX — the lat/lon min→max actually queried, plus its
  //   computed centre so the "bbox centre == selected location" relationship is
  //   visible and verifiable. Both read from the same state the query uses, so
  //   the display can never silently differ from what is sent.
  _updateLocationReadout() {
    const selEl = this.panel.querySelector('#dv-selloc');
    if (selEl) {
      const p = this.selectedPoint;
      if (p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
        selEl.textContent = `Lat ${p.latitude.toFixed(3)}° | Lon ${p.longitude.toFixed(3)}°`;
        selEl.classList.remove('empty');
      } else {
        selEl.textContent = 'No location selected — pick a point on the globe.';
        selEl.classList.add('empty');
      }
    }
    const regEl = this.panel.querySelector('#dv-region');
    if (regEl) {
      const b = this._readBbox();
      if (b && Number.isFinite(b.latMin) && Number.isFinite(b.latMax) &&
          Number.isFinite(b.lonMin) && Number.isFinite(b.lonMax)) {
        const cLat = (b.latMin + b.latMax) / 2;
        const cLon = (b.lonMin + b.lonMax) / 2;
        regEl.textContent =
          `Lat ${b.latMin.toFixed(3)}° → ${b.latMax.toFixed(3)}°  |  ` +
          `Lon ${b.lonMin.toFixed(3)}° → ${b.lonMax.toFixed(3)}°  ·  ` +
          `centre ${cLat.toFixed(3)}°, ${cLon.toFixed(3)}°`;
      } else {
        regEl.textContent = '';
      }
    }
  }

  async _loadFloats() {
    const btn = this.panel.querySelector('#dv-load');
    btn.disabled = true;
    this._status('Loading floats from source…');
    this.panel.querySelector('#dv-list').innerHTML = '';
    const bbox = this._readBbox();
    // Keep the transform bounds in sync so markers land where expected.
    this.geo.setBounds(bbox);
    this._updateLocationReadout();  // keep the region readout in sync with the inputs
    const limit = parseInt(this.panel.querySelector('#dv-limit').value, 10) || null;

    // Argo OBSERVATION time window (Parts 15–17) — wholly SEPARATE from the model
    // time axis. Each datetime-local field maps to a canonical UTC ISO (or null when
    // empty, so the server applies its own default window — never a fabricated bound).
    // Filtering is done SERVER-SIDE by listObservations (time>=/time<=); nothing is
    // synthesised or filtered client-side.
    const ostart = isoFromLocalInput(this.panel.querySelector('#dv-ostart')?.value);
    const oend = isoFromLocalInput(this.panel.querySelector('#dv-oend')?.value);
    const win = validateWindow(ostart, oend);
    if (!win.ok) {
      this._status(win.error, 'err');   // e.g. From after To — reject honestly, fetch nothing
      btn.disabled = false;
      return;
    }

    try {
      const res = await this.service.listObservations({ dataset: this.dataset, bbox, limit, start: ostart, end: oend });
      this.observations = res.observations || [];
      const n = await this.layer.setData(this.observations);
      this._renderList();
      if (n === 0) {
        this._status('No floats returned for this region/time. Try widening the box.', '');
      } else {
        this._status(`Loaded ${n} float${n === 1 ? '' : 's'}. Click a marker or a row for its profile.`, 'ok');
      }
    } catch (e) {
      this.layer.clear();
      this.observations = [];
      if (e.status === 503 || e.isUpstreamUnavailable) {
        this._show503Error();
      } else {
        this._status(e instanceof DataError ? e.toDisplay() : String(e), 'err');
      }
    } finally {
      btn.disabled = false;
    }
  }

  _show503Error() {
    const el = this.panel.querySelector('#dv-status');
    el.className = 'dv-status err dv-status-503';
    el.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;color:#fca5a5;">INCOIS ERDDAP temporarily unavailable</div>
      <div style="margin-bottom:4px;color:#cbd5e1;">HTTP 503</div>
      <div style="margin-bottom:8px;font-style:italic;color:#94a3b8;font-size:11px;">No synthetic data used.</div>
      <button class="dv-retry-btn" id="dv-503-retry" style="padding:4px 12px;background:#38bdf8;color:#0f172a;border:none;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;">Retry</button>
    `;
    const retryBtn = el.querySelector('#dv-503-retry');
    if (retryBtn) {
      retryBtn.onclick = () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying…';
        this._loadFloats();
      };
    }
  }

  _renderList() {
    const list = this.panel.querySelector('#dv-list');
    list.innerHTML = '';
    this.observations.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'dv-item';
      row.dataset.index = i;
      const lat = Number.isFinite(o.latitude) ? o.latitude.toFixed(2) : '—';
      const lon = Number.isFinite(o.longitude) ? o.longitude.toFixed(2) : '—';
      row.innerHTML = `<div class="id">${o.platformId}</div>` +
        `<div class="sub">${lat}°, ${lon}° · ${(o.time || '').slice(0, 16).replace('T', ' ')} · ${o.platformType || ''}</div>`;
      row.onclick = () => this.selectByIndex(i);
      list.appendChild(row);
    });
  }

  _markActiveRow(index) {
    this.panel.querySelectorAll('.dv-item').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.index, 10) === index);
    });
  }

  /** Shared selection entry point for both the list and 3D marker clicks. */
  async selectByIndex(index) {
    const o = this.observations[index];
    if (!o) return;
    this.layer.highlight(index);
    this._markActiveRow(index);
    if (!this.panel.classList.contains('open')) { /* leave panel state as-is */ }

    if (this.onFocus && this.panel.querySelector('#dv-focus').checked) {
      const pos = this.layer.worldPositionOf(index);
      if (pos) { try { this.onFocus(pos); } catch (_) {} }
    }

    this.viewer.showMessage(`Float ${o.platformId}`,
      `${o.platformType || 'Argo float'} · ${o.time || ''}`, 'Loading profile…');
    try {
      const full = await this.service.getProfile(o.platformId, { dataset: this.dataset });
      this.viewer.show(full);
    } catch (e) {
      if (e.status === 503 || e.isUpstreamUnavailable) {
        this.viewer.showMessage(`Float ${o.platformId}`, 'INCOIS ERDDAP temporarily unavailable',
          'HTTP 503 · No synthetic data used.');
      } else {
        this.viewer.showMessage(`Float ${o.platformId}`, 'Profile unavailable',
          e instanceof DataError ? e.toDisplay() : String(e));
      }
    }
  }

  selectByPlatform(platformId) {
    const i = this.observations.findIndex((o) => String(o.platformId) === String(platformId));
    if (i >= 0) this.selectByIndex(i);
  }
}
