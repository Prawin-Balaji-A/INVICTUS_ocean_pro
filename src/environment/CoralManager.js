import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * CoralManager — auto-discovers EVERY coral GLB in src/assets/bed and scatters a
 * rich, natural, non-gridded coral bed across the whole seabed floor.
 *
 * Discovery is BUILD-SAFE: coral assets are pulled in with `import.meta.glob(...,
 * ?url)` (bundled in dev AND production), the same pattern used by AssetManifest
 * / ObservationLayer / ShipwreckManager. The previous version loaded a single
 * hard-coded '/src/assets/bed/corals2.glb' RUNTIME path, so production builds
 * shipped with no coral at all — this fixes that too. Any new corals*.glb the
 * user drops into src/assets/bed is included automatically; shipwreck.glb is
 * excluded by name.
 *
 * PERF (§coverage-vs-performance): each coral GLB can be a very dense reef (e.g.
 * corals2 is a ~1391-mesh reef). Cloning any such model dozens of times is the
 * ~2 FPS draw-call cliff. So instance counts are ADAPTIVE to a total mesh
 * budget: a heavy reef model gets only a few clones, a light single-coral model
 * gets many — coverage stays rich without ever exploding into tens of thousands
 * of clones. All instances are frustum-culled so only on-screen coral is drawn.
 *
 * Each instance:
 *   - is normalized to a believable per-instance coral-formation footprint
 *     (measured world-space bbox, so source-GLB scale is irrelevant),
 *   - is anchored to the seabed by its measured world-space bounding box
 *     (base rests just into the sand; verified below the surface),
 *   - has varied rotation/scale and mixed single/clustered placement (no grid),
 *   - keeps its sway animation LOCAL to the anchored group, so animated coral
 *     stays firmly planted.
 */

// Build-safe: every .glb in src/assets/bed is bundled; we keep only corals.
const bedAssetModules = import.meta.glob('../assets/bed/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});

// Total coral meshes across ALL instances (frustum-culled at render time). Sized
// to the "rich but safe" band — comparable to the handful of dense reefs the
// scene ran acceptably with, but spread over more, smaller, varied formations.
const MESH_BUDGET = 11000;
const MIN_PER_MODEL = 3;   // guarantee every coral type appears, for variety
const MAX_PER_MODEL = 14;  // stop a light model from spawning hundreds

// Per-instance target footprint (max horizontal world dimension, metres). Each
// coral clump is normalized into this band regardless of the source GLB's native
// scale, then given per-instance variation so no two read identically.
const FOOTPRINT_MIN = 14;
const FOOTPRINT_MAX = 30;

export class CoralManager {
  constructor(scene, floor) {
    this.scene = scene;
    this.floor = floor;
    this.mixers = [];
    this.corals = [];
    this.loaded = false;
    this.group = new THREE.Group();
    this.group.name = 'CoralCarpetGroup';
    this.scene.add(this.group);

    // Seabed extent the coral bed is scattered over.
    this.seabedBounds = { maxRadius: 250, minY: -152, maxY: -148 };

    this.placedPositions = [];
    this.loader = new GLTFLoader();
  }

  async load() {
    // Collect coral assets by filename (exclude the shipwreck), build-safe URLs.
    const coralUrls = [];
    for (const [path, url] of Object.entries(bedAssetModules)) {
      const filename = path.split('/').pop().toLowerCase();
      if (filename.includes('coral') && !filename.includes('shipwreck')) {
        coralUrls.push({ filename, url });
      }
    }

    if (coralUrls.length === 0) {
      console.warn('[CoralManager] No coral GLBs found in src/assets/bed — seabed will have no coral.');
      return;
    }

    // 1) Load + measure every coral model (mesh count for budgeting, world-space
    //    footprint for normalization).
    const templates = [];
    for (const { filename, url } of coralUrls) {
      try {
        const gltf = await this._loadAsset(url);
        if (!gltf || !gltf.scene) {
          console.warn(`[CoralManager] Failed to parse ${filename}`);
          continue;
        }
        gltf.scene.updateMatrixWorld(true);

        let meshCount = 0;
        gltf.scene.traverse((o) => { if (o.isMesh) meshCount++; });

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const footprint = Math.max(size.x, size.z) || Math.max(size.x, size.y, size.z) || 1;

        templates.push({
          filename,
          gltf,
          meshCount: Math.max(1, meshCount),
          footprint,
          animations: gltf.animations || [],
        });
        console.log(`[CoralManager] Loaded ${filename}: ${meshCount} meshes, footprint ${footprint.toFixed(1)}u`);
      } catch (err) {
        console.warn(`[CoralManager] Error loading ${filename}:`, err.message || err);
      }
    }

    if (templates.length === 0) {
      console.warn('[CoralManager] No coral models loaded.');
      return;
    }

    // 2) Allocate instance counts by a shared mesh budget: dense reef => few
    //    clones, light coral => many. Keeps draw calls bounded regardless of what
    //    coral assets the user supplies.
    const perModelBudget = MESH_BUDGET / templates.length;
    const slots = [];
    for (const t of templates) {
      const raw = Math.round(perModelBudget / t.meshCount);
      t.instanceCount = Math.max(MIN_PER_MODEL, Math.min(MAX_PER_MODEL, raw));
      for (let i = 0; i < t.instanceCount; i++) slots.push(t);
    }

    // 3) Interleave (shuffle) so coral TYPES are mixed across the seabed rather
    //    than clumped by model — Fisher–Yates.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    // 4) Place every slot with density-by-distance + occasional clustering.
    let lastPos = null;
    let placed = 0;
    for (let i = 0; i < slots.length; i++) {
      const pos = this._nextPosition(lastPos);
      const ok = this._placeInstance(slots[i], pos, i);
      if (ok) { lastPos = pos; placed++; }
    }

    this.loaded = true;
    const totalMeshes = templates.reduce((s, t) => s + t.instanceCount * t.meshCount, 0);
    console.log(`[CoralManager] Coral bed: ${placed} formations from ${templates.length} models ` +
      `(~${totalMeshes} meshes, frustum-culled).`);
  }

  _loadAsset(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  // Denser toward the center, sparser toward the edges; ~1/3 of the time cluster
  // near the previous coral so the bed reads as mixed singles + natural groups
  // rather than a uniform grid.
  _nextPosition(lastPos) {
    const { maxRadius } = this.seabedBounds;

    const cluster = lastPos && Math.random() < 0.35;
    const minSpacing = cluster ? 10 : 22;

    let x = 0, z = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      if (cluster) {
        x = lastPos.x + (Math.random() - 0.5) * 44;
        z = lastPos.z + (Math.random() - 0.5) * 44;
      } else {
        const angle = Math.random() * Math.PI * 2;
        // pow > 1 biases the radius small => denser center (density-by-distance)
        const radius = maxRadius * Math.pow(Math.random(), 1.6);
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
      }
      // keep within the seabed square
      x = Math.max(-maxRadius, Math.min(maxRadius, x));
      z = Math.max(-maxRadius, Math.min(maxRadius, z));

      let valid = true;
      for (const p of this.placedPositions) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz < minSpacing * minSpacing) { valid = false; break; }
      }
      if (valid) break;
    }

    this.placedPositions.push({ x, z });
    // Seat on the ACTUAL undulating dune surface at this world (x,z) — exactly
    // what the Floor vertex shader renders — not the flat plane base at -depth.
    // The old flat -depth seabedY is why corals sat partly underground: the sand
    // around them renders up to ~3.9 m ABOVE -depth, burying the base.
    const seabedY = this.floor ? this.floor.heightAt(x, z) : -150;
    return { x, y: seabedY, z };
  }

  _placeInstance(template, pos, index) {
    try {
      const model = SkeletonUtils.clone(template.gltf.scene);

      // Normalize to a believable, per-instance-varied coral footprint.
      const targetFootprint = FOOTPRINT_MIN + Math.random() * (FOOTPRINT_MAX - FOOTPRINT_MIN);
      const scale = targetFootprint / template.footprint;
      model.scale.setScalar(scale);

      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.frustumCulled = true;   // only draw on-screen coral (perf)
          obj.castShadow = false;
          obj.receiveShadow = true;
        }
      });
      model.updateMatrixWorld(true);

      const anchor = new THREE.Group();
      anchor.name = `CoralAnchor_${template.filename.replace('.glb', '')}_${index}`;
      anchor.rotation.y = Math.random() * Math.PI * 2;      // varied heading
      anchor.add(model);
      anchor.updateMatrixWorld(true);

      // Sway animation is LOCAL to the anchor group. Build the mixer BEFORE
      // seating so the pose can be sampled across the whole sway cycle: an
      // animated coral's bottom moves, so anchoring off a single frame can bury
      // the base or lift it off the sand at other phases.
      let mixer = null, action = null, clip = null;
      if (template.animations.length > 0) {
        clip = template.animations[0];
        if (clip) {
          mixer = new THREE.AnimationMixer(model);
          action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        }
      }

      // Lowest world-space point the coral ever reaches over its sway cycle,
      // measured relative to the (still origin-positioned) anchor. Static coral
      // is measured once. This is the point we plant into the sand.
      const bottomOffset = this._measureLowestBottom(anchor, mixer, action, clip);

      // Seat that lowest point just into the dune surface at this world (x,z).
      // pos.y is floor.heightAt(x,z) — the real, undulating seabed — so the base
      // rests in the sand regardless of the dune relief beneath it.
      const embedding = 0.5;
      const seabedY = pos.y;
      anchor.position.set(pos.x, (seabedY - embedding) - bottomOffset, pos.z);
      anchor.updateMatrixWorld(true);

      // Safety: coral must be well below the surface (it sits on the seabed).
      const finalBox = new THREE.Box3().setFromObject(anchor);
      if (finalBox.max.y > -70) {
        console.error(`[CoralManager] ${anchor.name} invalid depth (maxY=${finalBox.max.y.toFixed(1)}), skipping.`);
        if (mixer) mixer.stopAllAction();
        return false;
      }

      this.group.add(anchor);
      this.corals.push(anchor);

      // Desync each instance's phase so the bed doesn't sway in unison, then run.
      if (mixer && action && clip) {
        action.time = clip.duration > 0 ? (index * 1.7) % clip.duration : 0;
        this.mixers.push(mixer);
      }

      // §7 trace: lowest point (bottomY) seated `embedding` below the dune
      // surface (seabedY); offset is the coral's own lowest extent below anchor.
      console.log(`[Seabed] coral=${template.filename} bottomY=${(seabedY - embedding).toFixed(2)} ` +
        `seabedY=${seabedY.toFixed(2)} offset=${bottomOffset.toFixed(2)}`);
      return true;
    } catch (err) {
      console.warn(`[CoralManager] Failed to place ${template.filename} #${index}:`, err.message || err);
      return false;
    }
  }

  // Lowest world-space bottom of `anchor` relative to its origin. For animated
  // coral we sample the pose across the full sway cycle and keep the MINIMUM, so
  // seating uses the deepest the base ever reaches — never a single frame when
  // animation moves the bottom (§7). Static coral is measured once. Coral sway
  // is transform/node animation, which Box3.setFromObject reflects correctly
  // after mixer.update + updateMatrixWorld. The anchor is at the origin here, so
  // box.min.y is already relative to it.
  _measureLowestBottom(anchor, mixer, action, clip) {
    const box = new THREE.Box3();
    if (!mixer || !action || !clip || clip.duration <= 0) {
      box.setFromObject(anchor);
      return box.min.y;
    }
    const SAMPLES = 12;
    let lowest = Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      action.time = (clip.duration * i) / SAMPLES;
      mixer.update(0);
      anchor.updateMatrixWorld(true);
      box.setFromObject(anchor);
      if (box.min.y < lowest) lowest = box.min.y;
    }
    // Return to a clean phase; _placeInstance assigns the final desync time.
    action.time = 0;
    mixer.update(0);
    anchor.updateMatrixWorld(true);
    if (lowest === Infinity) { box.setFromObject(anchor); lowest = box.min.y; }
    return lowest;
  }

  update(dt) {
    for (const mixer of this.mixers) {
      mixer.update(dt);
    }
  }
}
