/**
 * PerformanceProfiler - DEVELOPMENT-ONLY performance measurement overlay.
 *
 * This is a READ-ONLY instrument. It changes no rendering or simulation
 * behaviour; it only measures and displays. It is fully disabled outside of
 * `import.meta.env.DEV` (i.e. it never runs in a production build).
 *
 * It measures, per frame:
 *   - FPS, frame time (ms)
 *   - CPU sub-system timings (coral, instruments, ecosystem, mixers,
 *     codex/radar, scene update) and CPU render-submit time
 *   - renderer.info: draw calls, triangles, geometries, textures, programs
 *   - counts: creatures, schools, active mixers, coral clusters, particles
 *   - devicePixelRatio (effective + raw), renderer type, postprocessing state,
 *     active (intensity>0) lights
 *
 * Baseline capture (so a headless session can read REAL numbers):
 *   Press 1..8 to tag the current scenario A..H, hold the camera in that
 *   state for a few seconds, then press 0 to stop tagging. While a tag is
 *   active, a compact snapshot is POSTed to /api/perf ~1x/second and appended
 *   to server/perf-samples.ndjson. Press P to hide/show the overlay.
 *
 * TEST SCENARIOS (user drives the camera; keys tag the samples):
 *   1=A stationary   2=B moving        3=C many creatures  4=D few creatures
 *   5=E coral-heavy  6=F open water    7=G headlight ON     8=H headlight OFF
 */

const TAG_LABELS = {
  '1': 'A-stationary', '2': 'B-moving', '3': 'C-many-creatures', '4': 'D-few-creatures',
  '5': 'E-coral-heavy', '6': 'F-open-water', '7': 'G-headlight-on', '8': 'H-headlight-off',
};

export class PerformanceProfiler {
  constructor() {
    // Hard dev-only guard. In a production build this becomes an inert no-op.
    this.enabled = !!(import.meta && import.meta.env && import.meta.env.DEV);

    this._starts = new Map();
    this.timings = {
      coral: 0, instruments: 0, eco: 0, mixers: 0, codexRadar: 0, scene: 0, render: 0,
    };

    // FPS / frame time
    this.frameCount = 0;
    this.lastFpsSample = performance.now();
    this.fps = 0;
    this.frameTime = 0;
    this._frameStart = 0;

    // capture state
    this.tag = null;               // active scenario tag, or null
    this._lastPost = 0;
    this._lastDom = 0;
    // Start HIDDEN so the dev overlay never covers the top-left Ocean Data
    // panel. It is dev-only and unchanged in behaviour otherwise — press "P"
    // (or window.perfProfiler) to show it again during development.
    this._visible = false;

    // dynamic-data provider, wired via attach()
    this._renderer = null;
    this._countsFn = null;

    if (!this.enabled) return;

    this._createOverlay();
    this._bindKeys();
    window.perfProfiler = this;
    // Convenience: dump a quick console summary of what the overlay shows.
    window.perfSnapshot = () => this._buildSnapshot();
  }

  /** Wire the renderer + a callback returning the live dynamic counts. */
  attach(renderer, countsFn) {
    this._renderer = renderer;
    this._countsFn = countsFn;
  }

  // ---- per-frame timing hooks (called from the animate loop) ----
  frameStart() {
    if (!this.enabled) return;
    this._frameStart = performance.now();
  }

  start(name) {
    if (!this.enabled) return;
    this._starts.set(name, performance.now());
  }

  end(name) {
    if (!this.enabled) return;
    const s = this._starts.get(name);
    if (s === undefined) return;
    const elapsed = performance.now() - s;
    // EMA so the number is readable rather than jittery.
    this.timings[name] = (this.timings[name] || 0) * 0.85 + elapsed * 0.15;
  }

  frameEnd() {
    if (!this.enabled) return;
    const now = performance.now();
    const frameElapsed = now - this._frameStart;
    this.frameTime = this.frameTime * 0.9 + frameElapsed * 0.1;

    this.frameCount++;
    if (now - this.lastFpsSample >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsSample));
      this.frameCount = 0;
      this.lastFpsSample = now;
    }

    if (now - this._lastDom >= 250) { this._lastDom = now; this._updateDom(); }
    if (this.tag && now - this._lastPost >= 1000) { this._lastPost = now; this._postSample(); }
  }

  // ---- snapshot ----
  _buildSnapshot() {
    const info = this._renderer ? this._renderer.info : null;
    const caps = this._renderer ? this._renderer.capabilities : null;
    const c = (this._countsFn && this._countsFn()) || {};
    const cpuSim = this.timings.coral + this.timings.instruments + this.timings.eco +
      this.timings.mixers + this.timings.codexRadar + this.timings.scene;
    const fps = this.fps || 0;
    // True wall-clock frame interval (consistent with FPS): 60fps=16.7ms, 20fps=50ms.
    const trueFrameMs = fps > 0 ? 1000 / fps : 0;
    // JS main-thread time actually spent inside animate() this frame (EMA).
    const mainThreadMs = this.frameTime;
    // Everything not on the JS main thread: GPU execute + present + rAF wait.
    // A large gap here means the frame is GPU/fill-bound, not CPU-bound.
    const gpuIdleMs = Math.max(0, trueFrameMs - mainThreadMs);
    return {
      t: Date.now(),
      tag: this.tag,
      fps,
      frameMs: +trueFrameMs.toFixed(2),        // true interval (matches FPS)
      mainThreadMs: +mainThreadMs.toFixed(2),  // JS work in animate()
      gpuIdleMs: +gpuIdleMs.toFixed(2),        // GPU/present/idle gap
      cpuMs: +cpuSim.toFixed(2),               // sum of sim subsystems
      renderMs: +this.timings.render.toFixed(2), // CPU render-submit
      cpu: {
        coral: +this.timings.coral.toFixed(2),
        instruments: +this.timings.instruments.toFixed(2),
        eco: +this.timings.eco.toFixed(2),
        mixers: +this.timings.mixers.toFixed(2),
        codexRadar: +this.timings.codexRadar.toFixed(2),
        scene: +this.timings.scene.toFixed(2),
      },
      draw: info ? info.render.calls : 0,
      tris: info ? info.render.triangles : 0,
      geometries: info ? info.memory.geometries : 0,
      textures: info ? info.memory.textures : 0,
      programs: info && info.programs ? info.programs.length : 0,
      creatures: c.creatures ?? 0,
      schools: c.schools ?? 0,
      mixers: c.mixers ?? 0,
      coral: c.coral ?? 0,
      particles: c.particles ?? 0,
      lights: c.lights ?? 0,
      dpr: this._renderer ? +this._renderer.getPixelRatio().toFixed(2) : 0,
      dprRaw: +(window.devicePixelRatio || 1).toFixed(2),
      webgl2: caps ? !!caps.isWebGL2 : false,
      post: c.post ?? 'on',
      underwater: !!c.underwater,
    };
  }

  _postSample() {
    try {
      const s = this._buildSnapshot();
      fetch('/api/perf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* never let telemetry break the frame */ }
  }

  // ---- DOM ----
  _createOverlay() {
    const el = document.createElement('div');
    el.id = 'perf-overlay';
    el.style.cssText = `
      position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.82);
      color:#9be7ff;font-family:ui-monospace,monospace;font-size:11px;
      padding:10px 13px;border-radius:8px;border:1px solid rgba(79,211,255,0.3);
      z-index:99999;pointer-events:none;min-width:250px;line-height:1.55;
      white-space:pre;`;
    document.body.appendChild(el);
    this._el = el;
    // Honour the initial visibility state (starts hidden; press "P" to show).
    el.style.display = this._visible ? 'block' : 'none';
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') {
        this._visible = !this._visible;
        this._el.style.display = this._visible ? 'block' : 'none';
        return;
      }
      if (e.key === '0') { this.tag = null; return; }
      if (TAG_LABELS[e.key]) { this.tag = TAG_LABELS[e.key]; this._lastPost = 0; }
    });
  }

  _fmt(s) {
    const fpsColor = s.fps >= 55 ? '#7CFC9B' : s.fps >= 30 ? '#ffcc00' : '#ff5566';
    const rec = this.tag ? `  ● REC:${this.tag}` : '';
    // Which side dominates the frame? Helps classify the bottleneck at a glance.
    const bound = s.gpuIdleMs > s.mainThreadMs ? 'GPU-bound' : 'CPU-bound';
    return [
      `PERF [DEV]${rec}`,
      `<span style="color:${fpsColor};font-size:15px;font-weight:bold">${s.fps} FPS</span>  frame ${s.frameMs}ms`,
      `main-thread ${s.mainThreadMs}ms  gpu/idle ${s.gpuIdleMs}ms`,
      `<span style="color:#ffd27f">${bound}</span>  cpu-sim ${s.cpuMs}  render ${s.renderMs}`,
      ` eco ${s.cpu.eco}  mix ${s.cpu.mixers}  coral ${s.cpu.coral}`,
      ` inst ${s.cpu.instruments}  cdx/rad ${s.cpu.codexRadar}  scn ${s.cpu.scene}`,
      `Draw ${s.draw}  Tris ${(s.tris / 1e6).toFixed(2)}M`,
      `Geo ${s.geometries}  Tex ${s.textures}  Prog ${s.programs}`,
      `Creat ${s.creatures}  Sch ${s.schools}  Mix ${s.mixers}`,
      `Coral ${s.coral}  Part ${s.particles}  Lights ${s.lights}`,
      `DPR ${s.dpr} (raw ${s.dprRaw})  ${s.webgl2 ? 'WebGL2' : 'WebGL1'}`,
      `Post ${s.post}${s.underwater ? ' · underwater' : ''}`,
      `<span style="color:#6b8">1-8=tag A-H · 0=stop · P=hide</span>`,
    ].join('\n');
  }

  _updateDom() {
    if (!this._visible) return;
    this._el.innerHTML = this._fmt(this._buildSnapshot());
  }
}
