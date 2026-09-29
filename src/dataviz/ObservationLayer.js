import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// The existing Argo float model supplied in the instruments asset folder.
// Imported with Vite's ?url query (the same build-safe pattern the creature
// loader uses in AssetManifest.js), so the asset is bundled for production and
// not merely served from /src in dev. We reuse ONLY the visual model here — the
// float positions come from the REAL INCOIS observation API, never from the
// hardcoded demo telemetry in ArgoManager/InstrumentManager.
import argoFloatUrl from '../assets/instruments/argo_float.glb?url';

/**
 * ObservationLayer — real observation platforms (Argo floats now; gliders / CTD
 * casts / buoys later) rendered as clickable 3D instrument models in the scene
 * (spec §17/§18/§20).
 *
 * Each platform is drawn with its REAL 3D instrument model (the .glb the user
 * supplied in src/assets/instruments), positioned from the observation's REAL
 * longitude / latitude via GeoTransform. The model is only the visual shell —
 * every scientific value (position, time, depth profile, QC) stays authoritative
 * from the ingestion service. Nothing here is fabricated: observations without a
 * finite position are skipped, never invented.
 *
 * Extensibility: INSTRUMENT_MODELS maps a platform "kind" to its existing model
 * URL, and templates are lazy-loaded on first use. When a real glider / buoy /
 * CTD feed is connected, register its existing .glb here and classify it in
 * kindOf() — nothing else changes. We NEVER spawn a platform for which there is
 * no real observation, so adding a model does not create fake data.
 *
 * Each model's pivot maps 1:1 to an entry in `this.observations`, so a raycast
 * hit resolves directly back to its data record.
 */

// kind → existing instrument .glb URL. Only Argo is wired now because Argo is
// the only real observation feed currently connected. To add another instrument
// when its real data is connected: `import xUrl from '../assets/instruments/x.glb?url'`
// then add one line here and a rule in kindOf(). The other instrument assets
// (glider.glb, moored_buoy.glb, rov.glb.glb) already exist and are left in place.
const INSTRUMENT_MODELS = {
  argo: argoFloatUrl,
  // glider: gliderUrl,      // when a real glider feed is connected
  // buoy:   mooredBuoyUrl,  // when a real moored-buoy feed is connected
  // ctd:    ctdUrl,         // when a real CTD-cast feed is connected
};

// Real-instrument scale (§5/§4/§16). An Argo float is a ~1.3 m surface buoy, so
// the model's LARGEST dimension is normalized to ~2 m (was 12 m — that oversized
// shell is what made distinct floats visually overlap into a "cluster" (§4) and
// read like a giant object rather than a small instrument (§5)). The value is a
// TARGET max-dimension; the actual scale is derived per-GLB from its MEASURED
// bounding box in _ensureTemplate (never a blind fixed multiplier), so whatever
// argo_float.glb's native size is, it ends up ~2 m on screen.
const MODEL_TARGET_SIZE = 2.0;  // world units (metres) for the model's largest dimension
// The marker IS the platform's SURFACE position (§16); the profile chart — not
// this marker — represents the 2000 m depth column. A ~2 m float sits at the
// waterline, so its centre rides just above Y=0 (base near the surface).
const SURFACE_Y = 1.2;
const HILITE = new THREE.Color('#4fe3ff');   // cyan selection ring

export class ObservationLayer {
  constructor(scene, geoTransform) {
    this.scene = scene;
    this.geo = geoTransform;
    this.group = new THREE.Group();
    this.group.name = 'ObservationLayer';
    this.visible = true;
    this.observations = [];
    this.selectedIndex = -1;

    this._loader = new GLTFLoader();
    this._templates = new Map();          // kind → { object, center:Vector3, fitScale:number }
    this._templatePromises = new Map();   // kind → in-flight load Promise
    this._models = [];                    // per-observation pivot Object3D (index-aligned)
    this._gen = 0;                        // guards against overlapping reloads

    // Persistent selection halo — a flat cyan ring placed at the selected
    // float's surface position. Model-agnostic, so we never have to recolour a
    // GLB's own materials to show selection. Ring radius tracks the ~2 m float
    // (was radius 11 for the old 12 m model, which drew a huge disc on the sea).
    const haloGeom = new THREE.TorusGeometry(2.6, 0.14, 8, 40);
    const haloMat = new THREE.MeshBasicMaterial({ color: HILITE, transparent: true, opacity: 0.9 });
    this._halo = new THREE.Mesh(haloGeom, haloMat);
    this._halo.rotation.x = Math.PI / 2;  // lay flat in the XZ (surface) plane
    this._halo.visible = false;
    this._halo.name = 'ObservationHalo';
    this.group.add(this._halo);

    scene.add(this.group);
  }

  /** Show/hide the whole layer. */
  setVisible(v) {
    this.visible = !!v;
    this.group.visible = this.visible;
  }

  /**
   * Map a canonical observation to an instrument kind. Every INCOIS Argo float
   * variant (PROVOR / ARVOR / APEX / NOVA / …) is Argo. Extend the rules here
   * when a real glider / buoy / CTD feed is connected.
   */
  kindOf(o) {
    const t = String(o?.platformType || '').toLowerCase();
    if (t.includes('glid')) return 'glider';
    if (t.includes('buoy') || t.includes('moor')) return 'buoy';
    if (t.includes('ctd')) return 'ctd';
    return 'argo';
  }

  /**
   * Load (and cache) the instrument template for a kind. Rejects with an
   * explicit, actionable error if the model asset is missing — we STOP and
   * surface it rather than substitute a placeholder.
   */
  _ensureTemplate(kind) {
    if (this._templates.has(kind)) return Promise.resolve(this._templates.get(kind));
    if (this._templatePromises.has(kind)) return this._templatePromises.get(kind);

    const url = INSTRUMENT_MODELS[kind];
    if (!url) {
      return Promise.reject(new Error(
        `No 3D model registered for observation kind "${kind}". ` +
        `Add its existing .glb to INSTRUMENT_MODELS in ObservationLayer.js.`));
    }
    const p = new Promise((resolve, reject) => {
      this._loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
    }).then((object) => {
      // Measure once so every clone can be normalized to a consistent on-screen
      // size and centred on its own geometry, regardless of the model's native
      // scale or pivot.
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fitScale = MODEL_TARGET_SIZE / maxDim;
      // §20: report the MEASURED native bbox and the resulting on-screen size so
      // the float scale is verifiable at runtime, not merely asserted. Final
      // largest dimension == MODEL_TARGET_SIZE by construction (fitScale × maxDim).
      console.log(
        `[ObservationLayer] "${kind}" model measured raw bbox ` +
        `${size.x.toFixed(3)}×${size.y.toFixed(3)}×${size.z.toFixed(3)} u ` +
        `(maxDim ${maxDim.toFixed(3)}) → fitScale ${fitScale.toFixed(4)} ` +
        `→ on-screen ~${(maxDim * fitScale).toFixed(2)} m largest dim.`);
      const rec = { object, center, fitScale };
      this._templates.set(kind, rec);
      this._templatePromises.delete(kind);
      return rec;
    }).catch((err) => {
      this._templatePromises.delete(kind);
      throw new Error(
        `Failed to load instrument model for "${kind}" (${url}): ${err?.message || err}`);
    });
    this._templatePromises.set(kind, p);
    return p;
  }

  /** Build one positioned, index-tagged model pivot from a loaded template. */
  _makeModel(rec, index) {
    const model = rec.object.clone(true);   // shares geometry/material with template
    const s = rec.fitScale;
    model.scale.setScalar(s);
    // Recentre so the clone's geometric centre is at the pivot origin.
    model.position.set(-rec.center.x * s, -rec.center.y * s, -rec.center.z * s);
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.userData.__obsIndex = index;      // raycast hit → observation index
    return pivot;
  }

  /** Remove current models; keep the persistent halo and the shared templates. */
  clear() {
    for (const m of this._models) this.group.remove(m);
    this._models = [];
    if (this._halo) this._halo.visible = false;
    this.observations = [];
    this.selectedIndex = -1;
  }

  /**
   * Rebuild markers from a list of canonical observations. Each observation must
   * carry finite `latitude` / `longitude`; entries missing a position are skipped
   * (never invented). Async because the instrument model is loaded on first use;
   * returns the number of models actually placed.
   */
  async setData(observations) {
    const myGen = ++this._gen;
    this.clear();
    const valid = (observations || []).filter(
      (o) => Number.isFinite(o.latitude) && Number.isFinite(o.longitude)
    );
    this.observations = valid;
    if (valid.length === 0) return 0;

    // Preload every template needed by this batch up front (usually just "argo").
    const kinds = [...new Set(valid.map((o) => this.kindOf(o)))];
    const recByKind = new Map();
    for (const k of kinds) recByKind.set(k, await this._ensureTemplate(k));
    if (myGen !== this._gen) return 0;   // a newer load superseded this one

    const p = new THREE.Vector3();
    for (let i = 0; i < valid.length; i++) {
      const o = valid[i];
      const rec = recByKind.get(this.kindOf(o));
      const pivot = this._makeModel(rec, i);
      // Real position from the observation's own coordinates.
      this.geo.lonLatToWorld(o.longitude, o.latitude, 0, p);
      pivot.position.set(p.x, SURFACE_Y, p.z);
      this.group.add(pivot);
      this._models.push(pivot);
    }
    this.group.visible = this.visible;
    return this._models.length;
  }

  /** World position of a marker by index (for camera focus). */
  worldPositionOf(index, out = new THREE.Vector3()) {
    const o = this.observations[index];
    if (!o) return null;
    this.geo.lonLatToWorld(o.longitude, o.latitude, 0, out);
    out.y = SURFACE_Y;
    return out;
  }

  indexOfPlatform(platformId) {
    return this.observations.findIndex((o) => String(o.platformId) === String(platformId));
  }

  /** Highlight one model (or pass -1 to clear): enlarge it and ring it. */
  highlight(index) {
    const prev = this.selectedIndex;
    if (prev >= 0 && this._models[prev]) this._models[prev].scale.setScalar(1);
    this.selectedIndex = index;
    const m = this._models[index];
    if (m) {
      m.scale.setScalar(1.5);
      // Ring the float at its surface position (stable regardless of model scale).
      this._halo.position.set(m.position.x, 0.5, m.position.z);
      this._halo.visible = true;
    } else {
      this._halo.visible = false;
    }
  }

  /**
   * Resolve a raycast against the models.
   * @returns {{index:number, observation:object}|null}
   */
  raycast(raycaster) {
    if (!this.visible || this._models.length === 0) return null;
    const hits = raycaster.intersectObjects(this._models, true);
    if (!hits.length) return null;
    // Walk up from the hit mesh to the pivot that carries the observation index.
    let o = hits[0].object;
    while (o && o.userData.__obsIndex === undefined) o = o.parent;
    if (!o) return null;
    const index = o.userData.__obsIndex;
    return { index, observation: this.observations[index] };
  }
}
