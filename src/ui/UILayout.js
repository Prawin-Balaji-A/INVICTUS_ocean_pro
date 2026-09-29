/**
 * UILayout — a small, reusable layout + overlap-validation helper for the
 * ocean-mode HUD chrome (spec §2/§9).
 *
 * It exists because several fixed-position surfaces were pinned to the SAME
 * top-left corner — the depth meter (#depth), the Ocean Data launcher
 * (#dv-launch) and its panel (#dv-panel) were all at top:16/left:16 (panel at
 * top:56) — so the Ocean Data UI rendered directly on top of, and hid, the depth
 * meter. Rather than nudge one element by an arbitrary pixel offset (which just
 * breaks again at another viewport size), this assigns REAL positions derived
 * from spacing tokens and MEASURED element sizes:
 *
 *   • a top-LEFT vertical lane — depth meter first (so it is never hidden), then
 *     the Ocean Data launcher, then the open panel — each seated below the
 *     previous by its measured height, so the three cannot overlap by
 *     construction regardless of their contents or the viewport size;
 *   • the ocean location badge anchored just to the RIGHT of the depth meter
 *     (measured, not a hardcoded left:132) and width-capped so its right edge
 *     always clears the right-side toolbar — responsively, at any width (§9);
 *   • the Ocean Data panel's max-height recomputed for its live top, so long
 *     float lists scroll instead of running off-screen or over the bottom card.
 *
 * It then VALIDATES the result: every visible managed pair is tested for a real
 * bounding-rect intersection and reported — `[UILayout] overlap check: PASS`
 * when clear, `[UILayout] OVERLAP: A ↔ B (WxH px)` when not. This is DETECTION
 * only; overlaps are resolved by real positioning above, never by bumping
 * z-index. Relayout + validate run on construction, on window resize, whenever a
 * managed element changes size (ResizeObserver — this is what catches the panel
 * opening/closing), and on class/hidden-attribute toggles of the managed
 * elements and <body> (mode switch).
 *
 * Decoupled by design: it only reads/writes inline top/left/max-* on elements it
 * looks up by id — it does NOT edit DataVizPanel or GlobeControls internals.
 * Note fixed-position elements report offsetParent === null, so visibility is
 * decided from getClientRects()/computed display, never from offsetParent.
 */

const TOKENS = {
  margin: 16,          // safe inset from the viewport's top/left edges
  gap: 10,             // vertical gap between stacked left-lane surfaces
  badgeGap: 12,        // horizontal breathing room around the location badge
  bottomReserve: 320,  // bottom band kept clear for the Codex focus card (z-95)
  badgeMinWidth: 120,  // never crush the location badge narrower than this
};

// Friendly names for the log lines (spec §2 shows "OceanDataPanel ↔ DepthMeter").
const LABELS = {
  'depth': 'DepthMeter',
  'dv-launch': 'OceanDataLauncher',
  'dv-panel': 'OceanDataPanel',
  'ocean-loc-badge': 'LocationBadge',
  'sim-toolbar': 'Toolbar',
};

export class UILayout {
  constructor() {
    this.ids = [];
    this._raf = 0;
    this._ro = null;
    this._mo = null;
    this._onResize = () => this.schedule();
  }

  /**
   * Register the managed element ids (without '#'). Missing ids are ignored, so
   * this is safe to call before every surface has been injected. Wires window
   * resize + a ResizeObserver (size changes / panel open+close) + a
   * MutationObserver on <body> and each element (class/hidden toggles — mode
   * switch, .open, .show). We deliberately do NOT observe the `style` attribute,
   * since relayout writes inline styles and that would feed back on itself.
   */
  register(ids) {
    this.ids = ids.slice();
    window.addEventListener('resize', this._onResize);

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.schedule());
      for (const id of this.ids) {
        const el = document.getElementById(id);
        if (el) this._ro.observe(el);
      }
    }

    this._mo = new MutationObserver(() => this.schedule());
    // Mode switches toggle body.globe-mode, which changes the computed display of
    // the managed surfaces; relayout so the lane/badge recompute for the mode.
    this._mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (const id of this.ids) {
      const el = document.getElementById(id);
      if (el) this._mo.observe(el, { attributes: true, attributeFilter: ['class', 'hidden'] });
    }

    this.relayout();
    return this;
  }

  /** Coalesce a burst of observer callbacks into one relayout on the next frame. */
  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.relayout(); });
  }

  _el(id) { return document.getElementById(id); }

  _visible(el) {
    // Fixed elements have offsetParent === null; getClientRects() is empty only
    // when the element (or an ancestor) is display:none — the reliable test here.
    return !!el && el.getClientRects().length > 0;
  }

  relayout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const { margin, gap, badgeGap, bottomReserve, badgeMinWidth } = TOKENS;

    const depth = this._el('depth');
    const launch = this._el('dv-launch');
    const panel = this._el('dv-panel');
    const badge = this._el('ocean-loc-badge');
    const toolbar = this._el('sim-toolbar');

    // 1) Top-LEFT vertical lane. Depth meter first (never hidden), then the Ocean
    //    Data launcher, then the open panel — each seated below the previous by
    //    its MEASURED height, so they cannot overlap whatever their contents.
    let y = margin;
    for (const el of [depth, launch, panel]) {
      if (!this._visible(el)) continue;
      el.style.top = `${y}px`;
      el.style.left = `${margin}px`;
      const h = el.getBoundingClientRect().height;
      if (el === panel) {
        // Last, scrollable surface: cap to the space between its live top and the
        // reserved bottom band so it scrolls rather than covering the bottom card.
        const maxH = Math.max(120, vh - y - bottomReserve);
        el.style.maxHeight = `${maxH}px`;
      }
      y += h + gap;
    }

    // 2) Location badge — anchored just right of the depth meter (measured, not a
    //    hardcoded left) and width-capped so its right edge always clears the
    //    right-side toolbar. Stays visually separate from the toolbar at any
    //    viewport width (§9).
    if (this._visible(badge)) {
      const depthRight = this._visible(depth) ? depth.getBoundingClientRect().right : margin;
      const left = Math.round(depthRight + badgeGap);
      const toolbarLeft = this._visible(toolbar) ? toolbar.getBoundingClientRect().left : (vw - margin);
      const maxRight = toolbarLeft - badgeGap;
      const maxWidth = Math.max(badgeMinWidth, Math.round(maxRight - left));
      badge.style.left = `${left}px`;
      badge.style.maxWidth = `${maxWidth}px`;
    }

    this.validate();
  }

  /**
   * Test every visible managed pair for a real bounding-rect intersection and
   * report it. Detection only — overlaps are fixed by positioning in relayout(),
   * never by hiding one element behind another with z-index.
   */
  validate() {
    const rects = [];
    for (const id of this.ids) {
      const el = this._el(id);
      if (this._visible(el)) rects.push({ id, r: el.getBoundingClientRect() });
    }

    const overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) {   // >1px on both axes = genuine overlap, not a touching edge
          overlaps.push({
            a: LABELS[rects[i].id] || rects[i].id,
            b: LABELS[rects[j].id] || rects[j].id,
            w: Math.round(ox), h: Math.round(oy),
          });
        }
      }
    }

    if (overlaps.length === 0) {
      console.log('[UILayout] overlap check: PASS');
    } else {
      for (const o of overlaps) {
        console.warn(`[UILayout] OVERLAP: ${o.a} ↔ ${o.b} (${o.w}x${o.h} px)`);
      }
    }
    return overlaps;
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this._mo) this._mo.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
