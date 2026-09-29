import * as THREE from 'three';

/**
 * GeoTransform — maps geographic coordinates to the Three.js world (spec §21).
 *
 *   longitude → world +X   (east is +X)
 *   latitude  → world −Z   (north is −Z, "into" the default view)
 *   depth (m) → world −Y   (down is −Y; the sea surface is Y = 0)
 *
 * The configurable geographic bounds (Indian EEZ by default, spec §22) are
 * mapped with a single `unitsPerDegree` scale (an equirectangular projection —
 * longitude is NOT cosine-corrected; this is documented, not hidden). The
 * mapped extent is centred on the world origin so markers sit around the
 * existing scene.
 *
 * Vertical exaggeration (spec §16) scales the Y (depth) axis ONLY. Physical
 * depth in metres is preserved separately — callers that print depth labels use
 * the original metres, never the exaggerated world Y.
 */
export class GeoTransform {
  constructor({
    bounds = { lonMin: 40, lonMax: 100, latMin: -10, latMax: 30 }, // Indian EEZ region
    unitsPerDegree = 8,      // world units per degree of lat/lon
    metresPerUnit = 1,       // scene convention: ~1 world unit = 1 metre
    verticalExaggeration = 1,
  } = {}) {
    this.bounds = { ...bounds };
    this.unitsPerDegree = unitsPerDegree;
    this.metresPerUnit = metresPerUnit;
    this.verticalExaggeration = verticalExaggeration;
    this._recompute();
  }

  _recompute() {
    const b = this.bounds;
    this.lonSpanDeg = b.lonMax - b.lonMin;
    this.latSpanDeg = b.latMax - b.latMin;
    this.lonMidDeg = (b.lonMin + b.lonMax) / 2;
    this.latMidDeg = (b.latMin + b.latMax) / 2;
    // Full world extent covered by the bounds (metres≈units at exaggeration 1).
    this.worldWidthX = this.lonSpanDeg * this.unitsPerDegree;
    this.worldDepthZ = this.latSpanDeg * this.unitsPerDegree;
  }

  /** Replace the geographic bounds (e.g. to switch region). */
  setBounds(bounds) {
    this.bounds = { ...this.bounds, ...bounds };
    this._recompute();
  }

  /** Set vertical exaggeration (1×, 2×, 5×, 10× …). Y axis only. */
  setVerticalExaggeration(k) {
    this.verticalExaggeration = Math.max(0.01, Number(k) || 1);
  }

  /**
   * Geographic → world position.
   * @param {number} lon degrees east
   * @param {number} lat degrees north
   * @param {number} depthMetres positive downward (0 = surface)
   * @param {THREE.Vector3} [out]
   */
  lonLatToWorld(lon, lat, depthMetres = 0, out = new THREE.Vector3()) {
    const x = (lon - this.lonMidDeg) * this.unitsPerDegree;
    const z = -(lat - this.latMidDeg) * this.unitsPerDegree;
    const y = -(depthMetres / this.metresPerUnit) * this.verticalExaggeration;
    return out.set(x, y, z);
  }

  /** Inverse of the horizontal mapping (depth ignored). */
  worldToLonLat(x, z) {
    return {
      lon: x / this.unitsPerDegree + this.lonMidDeg,
      lat: -z / this.unitsPerDegree + this.latMidDeg,
    };
  }

  /** True when a lon/lat falls inside the configured bounds. */
  contains(lon, lat) {
    const b = this.bounds;
    return lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;
  }

  /** Documented origin/scale summary (for UI / traceability). */
  describe() {
    const b = this.bounds;
    return (
      `lon→+X, lat→−Z, depth→−Y (surface Y=0). ` +
      `bounds lon[${b.lonMin},${b.lonMax}] lat[${b.latMin},${b.latMax}], ` +
      `${this.unitsPerDegree} units/deg, ~${this.metresPerUnit} m/unit, ` +
      `vertical ×${this.verticalExaggeration}.`
    );
  }
}
