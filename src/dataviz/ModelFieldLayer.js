import * as THREE from 'three';
import { ScientificColorScale, finiteExtent, DEFAULT_PALETTE } from './ModelFieldColor.js';

/**
 * ModelFieldLayer — renders ONE real gridded model/analysis field (a canonical
 * ModelField from OceanDataService.getModelField) as a 3D depth slice, aligned
 * to the existing ocean coordinate system via GeoTransform (spec §8–12).
 *
 * RENDERING ONLY. This class never fetches, generates, interpolates or alters
 * scientific data. It is handed an already-real ModelField and turns it into a
 * mesh:
 *   • one vertex per returned (latitude[i], longitude[j]) node, placed with
 *     geo.lonLatToWorld(lon, lat, depth) so the slice sits at the correct
 *     geographic position AND the correct depth (vertical position).
 *   • vertex colours from the isolated ScientificColorScale (palette / range /
 *     linear-log all live there).
 *   • MISSING cells (null) are respected: any quad touching a missing/non-finite
 *     corner is NOT emitted, so missing data never becomes a zero-valued or
 *     interpolated scientific sample. Those regions are simply absent.
 *
 * Phase 6 adds PURELY-VISUAL controls that never refetch or rebuild geometry:
 *   • applyColorScale({min,max,palette,scale}) — recolours the existing vertices
 *     from the STORED real values (missing nodes still skipped).
 *   • setOpacity(a) — this layer's material opacity only.
 *   • setVerticalExaggeration(k) — scales THIS layer's group Y only, so the
 *     visual depth is exaggerated without touching the shared GeoTransform (the
 *     Argo markers are unaffected) and without changing the field's real depth.
 *
 * Arbitrary grid dimensions are handled (nLat×nLon read from the arrays); no
 * fixed size and no hardcoded geographic position are assumed.
 */

// Default opacity: high enough that the saturated field reads as a solid data
// map (not a pale glass sheet), but still <1 so the seabed / ocean environment
// remains faintly visible through the slice. The opacity slider can override it.
const DEFAULT_OPACITY = 0.9;
const VEX_MIN = 1;      // 1× = true depth
const VEX_MAX = 20;     // bounded, sensible exaggeration range

export class ModelFieldLayer {
  constructor(scene, geoTransform) {
    this.scene = scene;
    this.geo = geoTransform;
    this.group = new THREE.Group();
    this.group.name = 'ModelFieldLayer';
    this.group.visible = true;
    this.visible = true;
    this._mesh = null;
    this.field = null;       // the ModelField currently rendered (for readouts)
    this.colorScale = null;  // ScientificColorScale for the current field

    // Persisted VISUAL state — survives re-renders so a new depth/variable slice
    // keeps the user's palette / range / scale / opacity / exaggeration.
    this._palette = DEFAULT_PALETTE;
    this._scale = 'linear';
    this._manualRange = null;        // {min,max} when the user overrode auto
    this._opacity = DEFAULT_OPACITY;
    this._vex = VEX_MIN;

    // Stored grid for in-place recolour (no refetch on visual changes).
    this._values = null;             // real values[latIndex][lonIndex]
    this._nLat = 0;
    this._nLon = 0;
    this._nodeIndex = null;          // i*nLon+j → vertexId (or -1 if missing)
    this._auto = null;               // {min,max} finite extent of current field

    this.group.scale.y = this._vex;
    scene.add(this.group);
  }

  setVisible(v) {
    this.visible = !!v;
    this.group.visible = this.visible;
  }

  /** Dispose the current mesh (geometry + material) and detach it. */
  clear() {
    if (this._mesh) {
      this.group.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    this.field = null;
    this.colorScale = null;
    this._values = null;
    this._nodeIndex = null;
    this._auto = null;
  }

  /**
   * Build the slice mesh from a real ModelField. Returns a summary (rendered
   * cell count, grid, data extent, and the effective colour range/scale) for
   * the panel, or throws if the field carries no finite values to display.
   *
   * The user's current palette/range/scale/opacity/exaggeration are re-applied,
   * so switching depth or variable does not reset the visual controls.
   *
   * @param {{latitude:number[], longitude:number[],
   *          values:Array<Array<number|null>>, depth:number|null,
   *          units:string, variable:string}} field
   */
  setField(field) {
    this.clear();
    if (!field || !Array.isArray(field.latitude) || !Array.isArray(field.longitude)
        || !Array.isArray(field.values)) {
      throw new Error('ModelFieldLayer.setField: malformed field (missing coordinate/value arrays)');
    }
    const lat = field.latitude;
    const lon = field.longitude;
    const vals = field.values;               // vals[latIndex][lonIndex]
    const nLat = lat.length;
    const nLon = lon.length;
    if (nLat < 2 || nLon < 2) {
      throw new Error(
        `Field grid too small to render a slice (${nLat}×${nLon}); widen the region.`);
    }

    // Real display domain from the field's own finite values (no fabrication).
    const extent = finiteExtent(vals);
    if (!extent) {
      throw new Error('Field contains no finite values in this region (all missing).');
    }
    this._auto = { min: extent.min, max: extent.max };

    // Effective colour range: the user's manual override if set, else auto.
    const range = this._manualRange || this._auto;
    this.colorScale = new ScientificColorScale({
      min: range.min, max: range.max, palette: this._palette, scale: this._scale,
    });
    // The stored scale mode may have been 'log' from a prior positive field;
    // keep it only if still valid for THIS field's range.
    this._scale = this.colorScale.scale;

    const depth = Number.isFinite(field.depth) ? field.depth : 0;

    // Vertex buffers. One vertex per finite (i,j) node; quads emitted only when
    // all four corners are finite so missing cells leave real holes.
    const positions = [];
    const colors = [];
    const indexOf = new Array(nLat * nLon).fill(-1);
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    let vCount = 0;

    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const v = vals[i]?.[j];
        if (v === null || v === undefined || !Number.isFinite(v)) continue; // missing → no vertex
        this.geo.lonLatToWorld(lon[j], lat[i], depth, p);
        positions.push(p.x, p.y, p.z);
        this.colorScale.colorFor(v, col);
        colors.push(col.r, col.g, col.b);
        indexOf[i * nLon + j] = vCount++;
      }
    }

    const indices = [];
    let quads = 0;
    for (let i = 0; i < nLat - 1; i++) {
      for (let j = 0; j < nLon - 1; j++) {
        const a = indexOf[i * nLon + j];
        const b = indexOf[i * nLon + (j + 1)];
        const c = indexOf[(i + 1) * nLon + j];
        const d = indexOf[(i + 1) * nLon + (j + 1)];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue; // a corner is missing → skip quad
        indices.push(a, c, b, b, c, d);
        quads++;
      }
    }

    if (quads === 0) {
      throw new Error('No fully-sampled cells to render (missing values dominate this region).');
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: this._opacity,
      depthWrite: true,   // a translucent slice shouldn't occlude the scene behind it
    });

    this._mesh = new THREE.Mesh(geom, mat);
    this._mesh.name = `ModelField:${field.variable || '?'}`;
    this._mesh.renderOrder = 5;
    this.group.add(this._mesh);
    this.group.visible = this.visible;
    this.group.scale.y = this._vex;   // re-apply exaggeration to the new mesh
    this.field = field;

    // Retain the real grid so purely-visual controls can recolour in place.
    this._values = vals;
    this._nLat = nLat;
    this._nLon = nLon;
    this._nodeIndex = indexOf;

    return {
      variable: field.variable,
      units: field.units,
      depth,
      nLat,
      nLon,
      renderedVertices: vCount,
      renderedCells: quads,
      totalCells: nLat * nLon,
      // Real finite extent of the field (the automatic range).
      autoMin: this._auto.min,
      autoMax: this._auto.max,
      // Effective visualization range/scale actually in use.
      min: this.colorScale.min,
      max: this.colorScale.max,
      palette: this.colorScale.palette,
      scale: this.colorScale.scale,
      logValid: this.colorScale.logValid(),
    };
  }

  /**
   * PURELY-VISUAL recolour. Updates palette / range / scale and recomputes the
   * vertex colours from the STORED real values — no refetch, no geometry
   * rebuild, missing nodes still skipped. Persists the settings so a later
   * setField keeps them. Returns the effective state so the panel can sync the
   * colorbar (and disable log when the requested range makes it invalid).
   *
   * @param {{min?:number, max?:number, palette?:string, scale?:string,
   *          manual?:boolean}} opts  `manual:true` marks the range as a user
   *          override (so subsequent auto-loads don't clobber it); `manual:false`
   *          clears the override (reset to auto).
   */
  applyColorScale(opts = {}) {
    if (opts.palette !== undefined) this._palette = opts.palette;

    if (opts.manual === false) {
      this._manualRange = null;   // reset → auto
    } else if (opts.min !== undefined || opts.max !== undefined) {
      const base = this._manualRange || this._auto || { min: 0, max: 1 };
      const min = opts.min !== undefined ? Number(opts.min) : base.min;
      const max = opts.max !== undefined ? Number(opts.max) : base.max;
      this._manualRange = { min, max };
      if (opts.manual === true) this._userRangeActive = true;
    }

    if (!this.colorScale) {
      // Nothing rendered yet — just persist requested palette/scale.
      if (opts.scale !== undefined) this._scale = opts.scale === 'log' ? 'log' : 'linear';
      return this._effectiveState();
    }

    const range = this._manualRange || this._auto;
    this.colorScale.setRange(range.min, range.max);
    this.colorScale.setPalette(this._palette);
    if (opts.scale !== undefined) this.colorScale.setScale(opts.scale);
    else this.colorScale.setScale(this._scale);
    this._scale = this.colorScale.scale;   // may have reverted to linear if invalid

    this._recolor();
    return this._effectiveState();
  }

  _effectiveState() {
    const cs = this.colorScale;
    return {
      min: cs ? cs.min : (this._manualRange || this._auto || {}).min,
      max: cs ? cs.max : (this._manualRange || this._auto || {}).max,
      palette: this._palette,
      scale: cs ? cs.scale : this._scale,
      logValid: cs ? cs.logValid() : false,
      autoMin: this._auto ? this._auto.min : null,
      autoMax: this._auto ? this._auto.max : null,
      manual: !!this._manualRange,
    };
  }

  /** Recompute the color attribute in place from the stored real values. */
  _recolor() {
    if (!this._mesh || !this._values || !this._nodeIndex) return;
    const attr = this._mesh.geometry.getAttribute('color');
    const col = new THREE.Color();
    const nLon = this._nLon;
    for (let i = 0; i < this._nLat; i++) {
      const row = this._values[i];
      for (let j = 0; j < nLon; j++) {
        const vid = this._nodeIndex[i * nLon + j];
        if (vid < 0) continue;                 // missing node — no vertex, skip
        this.colorScale.colorFor(row[j], col);
        attr.setXYZ(vid, col.r, col.g, col.b);
      }
    }
    attr.needsUpdate = true;
  }

  /** Layer opacity only (0..1). Does not touch any other scene object. */
  setOpacity(a) {
    const v = Math.min(1, Math.max(0, Number(a)));
    if (!Number.isFinite(v)) return;
    this._opacity = v;
    if (this._mesh) this._mesh.material.opacity = v;
  }

  /**
   * Vertical exaggeration of the depth slice — VISUAL ONLY. Scales this layer's
   * group Y so the slice sits deeper/shallower on screen, WITHOUT touching the
   * shared GeoTransform (Argo markers stay put) and WITHOUT changing the field's
   * real depth metadata. Bounded to [VEX_MIN, VEX_MAX]; default 1× = true depth.
   */
  setVerticalExaggeration(k) {
    const v = Math.min(VEX_MAX, Math.max(VEX_MIN, Number(k) || VEX_MIN));
    this._vex = v;
    this.group.scale.y = v;
    return v;
  }

  /** Centre of the current slice in world space (for camera focus), or null. */
  worldCenter(out = new THREE.Vector3()) {
    if (!this._mesh) return null;
    const box = new THREE.Box3().setFromObject(this._mesh);
    if (box.isEmpty()) return null;
    return box.getCenter(out);
  }
}

export { VEX_MIN, VEX_MAX, DEFAULT_OPACITY };
