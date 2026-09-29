import * as THREE from 'three';
import { marchingCubes, volumeExtent } from './MarchingCubes.js';
import { VEX_MIN, VEX_MAX } from './ModelFieldLayer.js';

/**
 * IsosurfaceLayer — renders ONE real 3-D isosurface extracted from a real,
 * depth-resolved model/analysis volume (a canonical ModelVolume from
 * OceanDataService.getModelVolume), aligned to the existing ocean coordinate
 * system via the SAME shared GeoTransform the depth slice and Argo markers use
 * (Phase 8).
 *
 * RENDERING ONLY. Like ModelFieldLayer, this class never fetches, generates,
 * interpolates or alters scientific data. It is handed an already-real volume
 * `values[depthIndex][latIndex][lonIndex]` (missing cells are `null`) plus an
 * isovalue in the field's real units, and turns the surface {field = isovalue}
 * into a mesh:
 *   • the pure marching-cubes extractor (MarchingCubes.js) produces ONE indexed
 *     triangle mesh in FRACTIONAL INDEX space;
 *   • each fractional index is mapped back to a REAL (lon, lat, depth) by linear
 *     interpolation of the volume's OWN axis arrays (longitude[]/latitude[]/
 *     depths[]) — so non-uniform depth spacing (5,50,200,… m) is honoured — and
 *     then placed with geo.lonLatToWorld(lon, lat, depthMetres). There is exactly
 *     ONE coordinate system (the real one); no second projection is invented.
 *   • MISSING data leaves real holes: any cell touching a null/non-finite corner
 *     emits nothing (the extractor's rule). Missing is never treated as zero and
 *     never interpolated across.
 *
 * COLOUR (spec): the isosurface is a surface of CONSTANT scalar value, so its
 * colour is a single hue = colorScale.colorFor(isovalue) — the SAME scale, and
 * therefore the same value→colour mapping, as the depth slice, the Geo View
 * raster and the colorbar. A modest emissive term keeps the surface legible in
 * the dim underwater scene while the scene lights still give it 3-D shape.
 *
 * VISUAL controls mirror ModelFieldLayer so the two layers behave identically:
 *   • setOpacity(a)                 — this layer's material opacity only.
 *   • setVerticalExaggeration(k)    — scales THIS layer's group Y (NOT the shared
 *     GeoTransform, whose VEX stays 1×), using the SAME [VEX_MIN,VEX_MAX] bounds
 *     as the slice, so a single VEX value moves slice and isosurface together and
 *     never double-applies.
 *   • setVisible(v).
 *
 * PERFORMANCE: nothing here runs per frame. The flattened typed-array volume is
 * built ONCE per fetched volume (setVolume); rebuild() re-runs marching cubes
 * only when the caller asks (isovalue / variable / timestep / volume / VEX-that-
 * needs-remap change). Old geometry + material are disposed on every rebuild and
 * on clear(). Grid sizes for the subset volumes are modest, so extraction is fast
 * enough synchronously — no Web Worker is used (it would add complexity for no
 * measurable gain at these sizes, and regeneration is event-driven, not looped).
 */

// Default opacity: 0.50 for translucent 3D scalar boundary allowing seabed,
// shipwreck, ocean environment and creatures to remain visible through the surface.
export const DEFAULT_OPACITY = 0.50;
// Self-illumination so the constant-value surface always reads as its scale
// colour even in dim water, while scene lights still add 3-D shading on top.
const EMISSIVE_INTENSITY = 0.35;

/** Linear interpolation of a real coordinate axis at a fractional index `f`. */
function interpAxis(axis, f) {
  const n = axis.length;
  if (n === 0) return 0;
  if (n === 1) return Number(axis[0]) || 0;
  if (f <= 0) return Number(axis[0]);
  if (f >= n - 1) return Number(axis[n - 1]);
  const i0 = Math.floor(f);
  const u = f - i0;
  const a = Number(axis[i0]);
  const b = Number(axis[i0 + 1]);
  return a + u * (b - a);
}

export class IsosurfaceLayer {
  constructor(scene, geoTransform) {
    this.scene = scene;
    this.geo = geoTransform;
    this.group = new THREE.Group();
    this.group.name = 'IsosurfaceLayer';
    this.visible = false;
    this.group.visible = false;
    this._mesh = null;

    // Visual state — persisted across rebuilds so a new isovalue / timestep /
    // variable keeps the user's opacity + exaggeration.
    this._opacity = DEFAULT_OPACITY;
    this._vex = VEX_MIN;

    // The current real volume, pre-flattened for marching cubes. Built ONCE per
    // fetched volume in setVolume(); rebuild() reuses it for new isovalues.
    this._volume = null;          // the raw ModelVolume (for readouts/provenance)
    this._data = null;            // Float64Array, x-fastest: data[i + nLon*(j + nLat*k)]
    this._dims = null;            // [nLon, nLat, nDepth]
    this._lon = null;             // real longitude[] axis
    this._lat = null;             // real latitude[] axis
    this._depths = null;          // real depths[] axis (metres, positive down)
    this._extent = null;          // real finite {min,max,count} of the volume
    this._units = '';
    this._variable = '';
    this._isovalue = null;        // the last isovalue meshed (for readouts)

    this.group.scale.y = this._vex;
    scene.add(this.group);
  }

  setVisible(v) {
    this.visible = !!v;
    this.group.visible = this.visible;
    if (this._mesh) {
      this._mesh.visible = this.visible;
    }
  }

  /** Dispose the current mesh (geometry + material) and detach it. */
  clearMesh() {
    if (this._mesh) {
      this.group.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    this._isovalue = null;
  }

  /**
   * Full reset — dispose the mesh AND drop the stored volume/typed arrays, so a
   * dataset switch (or leaving a model dataset) leaves nothing stale behind.
   */
  clear() {
    this.clearMesh();
    this._volume = null;
    this._data = null;
    this._dims = null;
    this._lon = null;
    this._lat = null;
    this._depths = null;
    this._extent = null;
    this._units = '';
    this._variable = '';
  }

  /** True once a real volume has been flattened and is ready to contour. */
  hasVolume() {
    return !!this._data && !!this._dims;
  }

  /**
   * Store a real ModelVolume and flatten it ONCE into the x-fastest typed array
   * marching cubes expects. Does NOT build a mesh (call rebuild() for that, when
   * the isovalue is known). Missing cells (null / non-finite) become NaN so the
   * extractor skips any cell that touches them — never zero-filled.
   *
   * Returns a summary (grid size, real value extent, real depth span) so the
   * panel can seed/bound the isovalue control from ACTUAL data — never hardcoded.
   * `renderable` is false when the subset is too thin in any axis to form a cell
   * or carries no finite value (the panel can then explain why, rather than draw
   * nothing silently).
   *
   * @param {{longitude:number[], latitude:number[], depths:number[],
   *          values:Array<Array<Array<number|null>>>, units?:string,
   *          variable?:string, time?:string}} volume
   */
  setVolume(volume) {
    this.clear();
    if (!volume || !Array.isArray(volume.longitude) || !Array.isArray(volume.latitude)
        || !Array.isArray(volume.depths) || !Array.isArray(volume.values)) {
      throw new Error('IsosurfaceLayer.setVolume: malformed volume (missing axis/value arrays)');
    }
    const lon = volume.longitude;
    const lat = volume.latitude;
    const depths = volume.depths;
    const values = volume.values;                 // values[depth][lat][lon]
    const nLon = lon.length;
    const nLat = lat.length;
    const nDepth = depths.length;

    // Flatten to x(lon)-fastest, then y(lat), then z(depth):
    //   data[i + nLon*(j + nLat*k)] = values[k][j][i]
    // matching marchingCubes' dims = [nx=nLon, ny=nLat, nz=nDepth].
    const data = new Float64Array(nLon * nLat * nDepth);
    for (let k = 0; k < nDepth; k++) {
      const plane = values[k];
      for (let j = 0; j < nLat; j++) {
        const row = plane ? plane[j] : undefined;
        for (let i = 0; i < nLon; i++) {
          const v = row ? row[i] : undefined;
          // null / undefined / NaN → NaN (MISSING): the extractor skips any cell
          // touching it, leaving a real hole. Never coerced to 0.
          data[i + nLon * (j + nLat * k)] =
            (v === null || v === undefined || !Number.isFinite(v)) ? NaN : v;
        }
      }
    }

    this._volume = volume;
    this._data = data;
    this._dims = [nLon, nLat, nDepth];
    this._lon = lon;
    this._lat = lat;
    this._depths = depths;
    this._extent = volumeExtent(values);          // real finite [min,max] or null
    this._units = volume.units || '';
    this._variable = volume.variable || '';

    const realDepths = depths.map(Number).filter(Number.isFinite);
    return {
      variable: this._variable,
      units: this._units,
      time: volume.time || null,
      nLon, nLat, nDepth,
      depthMin: realDepths.length ? Math.min(...realDepths) : null,
      depthMax: realDepths.length ? Math.max(...realDepths) : null,
      min: this._extent ? this._extent.min : null,
      max: this._extent ? this._extent.max : null,
      count: this._extent ? this._extent.count : 0,
      renderable: nLon >= 2 && nLat >= 2 && nDepth >= 2 && this._extent != null,
    };
  }

  /**
   * Extract and render the isosurface {field = isovalue} from the stored real
   * volume. Disposes any previous mesh first. Returns a summary (vertex/triangle
   * counts, the isovalue, the real data extent) for the panel, or a summary with
   * `empty:true` when the isovalue lies outside the real data range or no cell is
   * fully sampled (a legitimate "no surface here" — never an invented one).
   *
   * @param {number} isovalue real scalar value to contour (field units)
   * @param {import('./ModelFieldColor.js').ScientificColorScale|null} colorScale
   *        the SAME scale the depth slice uses; colorFor(isovalue) sets the hue.
   */
  rebuild(isovalue, colorScale = null) {
    this.clearMesh();
    const iso = Number(isovalue);
    if (!this.hasVolume()) {
      return { empty: true, isovalue: iso, vertexCount: 0, triangleCount: 0,
               variable: this._variable, units: this._units,
               min: this._extent ? this._extent.min : null,
               max: this._extent ? this._extent.max : null };
    }

    const { positions, indices, vertexCount, triangleCount } = marchingCubes({
      data: this._data, dims: this._dims, isovalue: iso,
    });

    this._isovalue = iso;

    if (triangleCount === 0) {
      // No crossing (iso outside the real range) or every candidate cell touches
      // missing data — leave the layer empty. Nothing fabricated.
      return { empty: true, isovalue: iso, vertexCount: 0, triangleCount: 0,
               variable: this._variable, units: this._units,
               min: this._extent ? this._extent.min : null,
               max: this._extent ? this._extent.max : null };
    }

    // Map fractional-index vertices → real (lon,lat,depth) → world. The marching
    // cubes output uses x=lon index, y=lat index, z=depth index (see dims above),
    // so we interpolate the matching real axis for each and reuse the shared
    // GeoTransform — the identical placement the depth slice/Argo markers use.
    const worldPos = new Float32Array(positions.length);
    const p = new THREE.Vector3();
    for (let v = 0; v < positions.length; v += 3) {
      const lon = interpAxis(this._lon, positions[v]);
      const lat = interpAxis(this._lat, positions[v + 1]);
      const depth = interpAxis(this._depths, positions[v + 2]);
      this.geo.lonLatToWorld(lon, lat, depth, p);
      worldPos[v] = p.x;
      worldPos[v + 1] = p.y;
      worldPos[v + 2] = p.z;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(worldPos, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));   // WebGL2: uint32 indices
    geom.computeVertexNormals();

    // Constant scalar value → single colour, from the SAME scale as the slice.
    const col = new THREE.Color(0xffffff);
    if (colorScale && typeof colorScale.colorFor === 'function') colorScale.colorFor(iso, col);

    const mat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: EMISSIVE_INTENSITY,
      roughness: 0.6,
      metalness: 0.0,
      side: THREE.DoubleSide,       // a marching-cubes shell is viewed from both sides
      transparent: true,
      opacity: this._opacity,
      depthWrite: false,           // translucent layer: do not occlude scene geometry behind it
    });

    this._mesh = new THREE.Mesh(geom, mat);
    this._mesh.name = `Isosurface:${this._variable || '?'}=${Number.isFinite(iso) ? iso : '?'}`;
    this._mesh.renderOrder = 6;     // just after the depth slice (5)
    this.group.add(this._mesh);
    this.group.visible = this.visible;
    this.group.scale.y = this._vex; // re-apply exaggeration to the new mesh

    return {
      empty: false,
      isovalue: iso,
      variable: this._variable,
      units: this._units,
      vertexCount,
      triangleCount,
      min: this._extent ? this._extent.min : null,
      max: this._extent ? this._extent.max : null,
    };
  }

  /** Re-colour the existing surface to a new isovalue's hue WITHOUT re-meshing. */
  applyColor(colorScale) {
    if (!this._mesh || !colorScale || typeof colorScale.colorFor !== 'function') return;
    if (this._isovalue === null || !Number.isFinite(this._isovalue)) return;
    const col = new THREE.Color(0xffffff);
    colorScale.colorFor(this._isovalue, col);
    this._mesh.material.color.copy(col);
    this._mesh.material.emissive.copy(col);
    this._mesh.material.needsUpdate = true;
  }

  /** Layer opacity only (0..1). Does not touch any other scene object. */
  setOpacity(a) {
    const v = Math.min(1, Math.max(0, Number(a)));
    if (!Number.isFinite(v)) return;
    this._opacity = v;
    if (this._mesh) this._mesh.material.opacity = v;
  }

  /**
   * Vertical exaggeration — VISUAL ONLY, identical mechanism and bounds to the
   * depth slice: scales THIS layer's group Y so the surface sits deeper/shallower
   * on screen WITHOUT touching the shared GeoTransform (Argo markers stay put) and
   * WITHOUT changing any real depth. Bounded to [VEX_MIN, VEX_MAX]; 1× = true depth.
   */
  setVerticalExaggeration(k) {
    const v = Math.min(VEX_MAX, Math.max(VEX_MIN, Number(k) || VEX_MIN));
    this._vex = v;
    this.group.scale.y = v;
    return v;
  }

  /** Centre of the current surface in world space (for camera focus), or null. */
  worldCenter(out = new THREE.Vector3()) {
    if (!this._mesh) return null;
    const box = new THREE.Box3().setFromObject(this._mesh);
    if (box.isEmpty()) return null;
    return box.getCenter(out);
  }
}
