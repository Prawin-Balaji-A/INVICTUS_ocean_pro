import * as THREE from 'three';

/**
 * ModelFieldColor — reusable SCIENTIFIC scalar→colour mapping for the gridded
 * depth-slice visualization (Phase 6). This replaces the temporary Phase 5 ramp
 * with a proper, data-driven colour scale:
 *
 *   • palette selection (perceptually-ordered sequential + a diverging map),
 *   • an explicit [min,max] visualization range (auto from real finite data, or
 *     a user override),
 *   • linear OR logarithmic scaling (log only where mathematically valid),
 *   • consistent handling of values outside the range (clamped to the ends),
 *   • null / non-finite values are the CALLER's responsibility — they are never
 *     coloured and never enter the range (those cells are simply not drawn).
 *
 * Nothing here generates or alters scientific data. It maps an already-real
 * value onto a colour. The scale is intentionally isolated from ModelFieldLayer
 * (the layer only depends on `colorFor`, `normalize`, and the mutators) so the
 * colour system stays reusable and independently testable.
 */

// -----------------------------------------------------------------------------
//  Palettes — a small, scientifically-useful, data-driven registry.
//  Each palette is an ordered list of evenly-spaced RGB stops (each channel
//  0..1) sampled by rampRGB(). The DEFAULT `ocean` map is a strongly-saturated
//  multi-hue oceanographic ramp (deep-blue → cyan → green → yellow → red, the
//  turbo/jet family long used for ocean scalar fields) chosen so the depth slice
//  reads vividly against the dark underwater scene instead of washing out.
//  Perceptually-ordered sequential maps + one diverging map follow for users who
//  prefer them. No decorative gradients — every entry is a real, useful colormap.
// -----------------------------------------------------------------------------
export const PALETTES = {
  ocean: {
    name: 'Ocean (blue→red)',
    type: 'sequential',
    // Saturated deep-navy → blue → cyan → green → yellow → orange → deep-red.
    // High chroma at every stop so the field stays clearly visible (and the
    // seabed shows through the layer's partial opacity) rather than pale/glassy.
    stops: [
      [0.031, 0.055, 0.286], [0.043, 0.204, 0.702], [0.000, 0.451, 0.949],
      [0.000, 0.792, 0.898], [0.051, 0.851, 0.549], [0.353, 0.867, 0.200],
      [0.749, 0.929, 0.098], [1.000, 0.898, 0.000], [1.000, 0.549, 0.000],
      [0.949, 0.251, 0.051], [0.749, 0.016, 0.051],
    ],
  },
  viridis: {
    name: 'Viridis',
    type: 'sequential',
    stops: [
      [0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530],
      [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
      [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318],
      [0.741, 0.873, 0.150], [0.993, 0.906, 0.144],
    ],
  },
  thermal: {
    name: 'Thermal',
    type: 'sequential',
    // inferno-like: black → purple → red → orange → pale yellow (warm fields)
    stops: [
      [0.001, 0.000, 0.014], [0.159, 0.043, 0.329], [0.365, 0.072, 0.432],
      [0.557, 0.145, 0.396], [0.751, 0.238, 0.290], [0.894, 0.393, 0.160],
      [0.966, 0.596, 0.056], [0.988, 0.812, 0.196], [0.988, 0.998, 0.645],
    ],
  },
  blues: {
    name: 'Blues',
    type: 'sequential',
    stops: [
      [0.969, 0.984, 1.000], [0.871, 0.922, 0.969], [0.776, 0.859, 0.937],
      [0.620, 0.792, 0.882], [0.420, 0.682, 0.839], [0.259, 0.573, 0.776],
      [0.129, 0.443, 0.710], [0.031, 0.318, 0.612], [0.031, 0.188, 0.420],
    ],
  },
  coolwarm: {
    name: 'Cool→Warm (diverging)',
    type: 'diverging',
    stops: [
      [0.230, 0.299, 0.754], [0.406, 0.537, 0.934], [0.601, 0.731, 0.996],
      [0.789, 0.855, 0.925], [0.930, 0.827, 0.762], [0.958, 0.647, 0.518],
      [0.870, 0.400, 0.328], [0.706, 0.016, 0.150],
    ],
  },
};

export const DEFAULT_PALETTE = 'ocean';

function _lerp(a, b, u) {
  return a + (b - a) * u;
}

/**
 * Sample an ordered list of evenly-spaced RGB stops at t∈[0,1] → [r,g,b].
 * Values outside [0,1] clamp to the ramp ends (consistent out-of-range colour).
 */
export function rampRGB(stops, t) {
  if (!Number.isFinite(t)) return [0, 0, 0];
  const n = stops.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return [...stops[0]];
  const x = Math.min(1, Math.max(0, t));
  const pos = x * (n - 1);
  const i = Math.min(n - 2, Math.floor(pos));
  const u = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [_lerp(a[0], b[0], u), _lerp(a[1], b[1], u), _lerp(a[2], b[2], u)];
}

/** True when `id` names a known palette. */
export function isPalette(id) {
  return Object.prototype.hasOwnProperty.call(PALETTES, id);
}

/**
 * A scientific colour scale bound to a [min,max] data domain, a palette, and a
 * scaling mode. `colorFor(value, target)` and `normalize(value)` are the only
 * things the layer depends on; the mutators let the panel recolour in place
 * (no data refetch) when the user changes a purely-visual control.
 */
export class ScientificColorScale {
  /**
   * @param {{min:number, max:number, palette?:string, scale?:'linear'|'log'}} opts
   */
  constructor({ min, max, palette = DEFAULT_PALETTE, scale = 'linear' } = {}) {
    this.setRange(min, max);
    this.setPalette(palette);
    this.setScale(scale);
    this._tmp = new THREE.Color();
  }

  /** Set the visualization domain. Order-normalized so min<max always holds. */
  setRange(min, max) {
    let lo = Number(min);
    let hi = Number(max);
    if (!Number.isFinite(lo)) lo = 0;
    if (!Number.isFinite(hi)) hi = lo + 1;
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    if (hi === lo) hi = lo + 1e-9;   // avoid divide-by-zero on a flat field
    this.min = lo;
    this.max = hi;
    return this;
  }

  setPalette(id) {
    this.palette = isPalette(id) ? id : DEFAULT_PALETTE;
    this._stops = PALETTES[this.palette].stops;
    return this;
  }

  /**
   * Set the scaling mode. Log is silently refused (falls back to linear) unless
   * mathematically valid, so a caller can never force a NaN/Infinity mapping.
   */
  setScale(mode) {
    this.scale = (mode === 'log' && this.logValid()) ? 'log' : 'linear';
    return this;
  }

  /**
   * Logarithmic scaling requires a strictly-positive, non-degenerate domain
   * (log10 is undefined for ≤0). SAL (~33–35 PSU) qualifies; a TEMP slice with
   * values ≤0 does not.
   */
  logValid() {
    return Number.isFinite(this.min) && Number.isFinite(this.max)
      && this.min > 0 && this.max > this.min;
  }

  /**
   * Real value → normalized position t∈[0,1] over the domain. Out-of-range
   * values clamp to 0/1 (consistent end-colour handling). Never returns
   * NaN/Infinity: in log mode the value is clamped into [min,max] first and
   * `logValid()` guarantees min>0.
   */
  normalize(value) {
    if (!Number.isFinite(value)) return NaN;
    if (this.scale === 'log' && this.logValid()) {
      const v = Math.min(this.max, Math.max(this.min, value));
      const lmin = Math.log10(this.min);
      const lmax = Math.log10(this.max);
      return (Math.log10(v) - lmin) / (lmax - lmin);
    }
    const t = (value - this.min) / (this.max - this.min);
    return Math.min(1, Math.max(0, t));
  }

  /**
   * Write the colour for a real value into `target` (a THREE.Color) and return
   * it. Non-finite input leaves the target unchanged (defensive; the layer
   * already filters missing nodes and never asks for their colour).
   */
  colorFor(value, target = this._tmp) {
    const t = this.normalize(value);
    if (!Number.isFinite(t)) return target;
    const [r, g, b] = rampRGB(this._stops, t);
    target.setRGB(r, g, b, THREE.SRGBColorSpace);
    return target;
  }

  /**
   * Real value → a CSS `rgb(r,g,b)` string (sRGB channels, 0–255), or `null` for a
   * non-finite / missing value so a 2-D canvas caller leaves that cell transparent
   * (never zero-filled). This is the SAME mapping `colorFor` writes into a
   * THREE.Color: `rampRGB` over the normalized position, taken as sRGB. Because the
   * 3-D mesh (`setRGB(..., SRGBColorSpace)`) and the colorbar (`rampRGB(...)*255`)
   * both display that raw sRGB triple, a canvas raster painted with `cssFor` matches
   * the depth slice and the colorbar exactly — one numeric value, one colour, in
   * every view. No second colour scale, no data invented.
   */
  cssFor(value) {
    const t = this.normalize(value);
    if (!Number.isFinite(t)) return null;
    const [r, g, b] = rampRGB(this._stops, t);
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }
}

/**
 * Compute the finite [min,max] of a 2-D values grid (values[i][j], with `null`
 * for missing cells). Returns null when there is no finite value. This is the
 * source of the AUTOMATIC visualization range — it reads the real values, it
 * never invents any, and null/non-finite cells are excluded from the extent.
 */
export function finiteExtent(values) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const row of values) {
    for (const v of row) {
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      count++;
    }
  }
  if (count === 0) return null;
  return { min, max, count };
}
