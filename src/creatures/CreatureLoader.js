import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { KnowledgeBuilder } from '../intelligence/KnowledgeBuilder.js';
import { DISCOVERED_ASSETS, getSchoolingAssets, getIndividualAssets, detectCategory } from './AssetManifest.js';

// Reused across skin-aware vertex sampling to avoid per-vertex allocation.
const _sampleVec = new THREE.Vector3();

/**
 * CreatureLoader - Dynamic creature asset discovery and loading.
 * 
 * Uses directory-based discovery:
 * - small/ = schooling fish (creates schools)
 * - others/ = individual large animals
 * - ground/ = benthic creatures
 * 
 * Technical configuration only (visual scale, spawn counts).
 * All biological behavior comes from KnowledgeProfile via intelligence pipeline.
 */

// Category-based target visual dimensions in world units (meters). Purely for
// scene presentation, NOT biological facts. Tuned as a DRAMATIC, strictly-ordered
// scene-presence hierarchy (each tier is clearly larger than the one below, not a
// single global multiplier):
//   small reef fish (2.2–3.4) ≪ fish 3.8 ≪ large_fish 8 ≪ manta 13 ≪ hammerhead 18
//   ≪ shark 20 ≪ orca 30 ≪ whale 60 (great whales promote higher via biology).
// A whale is ~20× a small reef fish and ~2× an orca, so megafauna truly dominate.
const CATEGORY_TARGET_SIZE = {
  whale:       60.0,
  orca:        30.0,
  shark:       20.0,
  hammerhead:  18.0,
  manta:       13.0,
  dolphin:      9.0,
  large_fish:   8.0,
  stingray:     7.0,
  octopus:      4.5,
  sea_turtle:   4.5,
  fish:         3.8,
  jellyfish:    3.0,
  default:      3.5,
};

// Reef/schooling fish in the small/ directory are kept small so they never fill
// the camera — but VISIBLY small, not tiny specks. The directory is the author's
// "this is a small fish" signal, so it takes precedence over the coarse category.
// Rather than snapping EVERY species to one identical value (which erases the
// natural size spread between reef fish and reads as artificial), each species —
// keyed by its GLB filename — gets a deterministic, stable size within a plausible
// small-reef-fish band. We have no exact per-species measurements and never
// fabricate them; this preserves biological size *uncertainty* while keeping every
// small fish clearly readable (~2.2–3.4 m) yet ~20× smaller than a whale.
const SMALL_DIR_MIN = 2.2;
const SMALL_DIR_MAX = 3.4;

// Stable djb2 string hash -> [0,1). A given filename always maps to the same
// size across reloads/instances (no per-frame or per-fish flicker), so a
// species is a consistent size while differing from its neighbours.
function stableUnit(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return ((h >>> 0) % 100000) / 100000;
}

// Technical scene-composition: spawn count and visual scale overrides
// NO biological knowledge here - only presentation settings
const ASSET_CONFIG = {
  // These are optional visual scale overrides per GLB filename
  // New GLBs without entries use category defaults
};

function findSwimClip(animations) {
  if (!animations || animations.length === 0) return null;
  const swims = animations.filter(a => a.name.toLowerCase().includes('swim') && !a.name.toLowerCase().includes('end'));
  if (swims.length > 0) return swims[0];
  
  const moves = animations.filter(a => {
    const l = a.name.toLowerCase();
    return l.includes('action') || l.includes('move') || l.includes('cycle') || l.includes('take') || l.includes('swing');
  });
  if (moves.length > 0) return moves[0];
  
  const nonStatic = animations.filter(a => !a.name.toLowerCase().includes('static') && !a.name.toLowerCase().includes('breathe') && !a.name.toLowerCase().includes('bite'));
  if (nonStatic.length > 0) return nonStatic[0];
  
  return animations[0];
}

export class CreatureLoader {
  constructor(scene, camera, ecosystemAI, creatureRegistry, oceanEnv) {
    this.scene = scene;
    this.camera = camera;
    this.ecosystemAI = ecosystemAI;
    this.registry = creatureRegistry;
    this.oceanEnv = oceanEnv;
    this.loader = new GLTFLoader();
    this.creatures = [];
    this.group = new THREE.Group();
    this.group.name = 'CreatureCarpet';
    this.scene.add(this.group);
    this.loadedCount = 0;
  }

  getTargetSize(category, filename, directory) {
    // Explicit per-asset override wins (technical, non-biological)
    if (ASSET_CONFIG[filename]?.targetSize) {
      return ASSET_CONFIG[filename].targetSize;
    }
    // small/ = reef/schooling fish -> keep genuinely small regardless of the
    // coarse detected category. Generic: any new small/*.glb auto-scales small,
    // to a stable per-species size within the small-reef band (not one identical
    // value for all species).
    if (directory === 'small') {
      return SMALL_DIR_MIN + stableUnit(filename) * (SMALL_DIR_MAX - SMALL_DIR_MIN);
    }
    return CATEGORY_TARGET_SIZE[category] || CATEGORY_TARGET_SIZE.default;
  }

  getSpawnCount(assetInfo) {
    // Schooling species (small/): spawn a RANDOM count in [min,max]. This was
    // `schoolSize.min` — i.e. ALWAYS the minimum (3 under the old {3,6}) — so
    // every reef species rendered as a sparse trio rather than a school. With
    // schoolSize {7,11} each species now spawns a visibly full school, and the
    // per-species random count keeps different species from all matching in size.
    if (assetInfo.isSchooling) {
      const min = assetInfo.schoolSize?.min ?? 7;
      const max = assetInfo.schoolSize?.max ?? min;
      return min + Math.floor(Math.random() * (max - min + 1));
    }
    return assetInfo.spawnCount || 1;
  }

  async loadAll(outCreatures) {
    const schoolingAssets = getSchoolingAssets();
    const individualAssets = getIndividualAssets();
    const total = schoolingAssets.length + individualAssets.length;
    console.log(
      `[Creature] discovered: ${total} asset(s) — ` +
      `${schoolingAssets.length} schooling (small/), ${individualAssets.length} individual (others/ + ground/)`);

    let ok = 0;
    let failed = 0;
    const failures = [];

    // Load every asset in its OWN try/catch. A single rejected/corrupt GLB must
    // NOT abort the remaining species — that silent all-or-nothing abort (a bare
    // `await` over the whole list) was the root cause of creatures going missing.
    // Failures are logged with their reason, never swallowed, and loading of the
    // remaining assets continues. Counts are NOT padded to hide a failure.
    for (const asset of schoolingAssets) {
      try {
        await this._loadAsset(asset, outCreatures, true);
        ok++;
      } catch (err) {
        failed++;
        failures.push(asset.filename);
        console.error(`[Creature] FAILED: ${asset.filename} — ${(err && err.message) ? err.message : String(err)}`);
      }
    }
    for (const asset of individualAssets) {
      try {
        await this._loadAsset(asset, outCreatures, false);
        ok++;
      } catch (err) {
        failed++;
        failures.push(asset.filename);
        console.error(`[Creature] FAILED: ${asset.filename} — ${(err && err.message) ? err.message : String(err)}`);
      }
    }

    console.log(
      `[CreatureLoader] Loaded ${this.loadedCount}/${total} creature species ` +
      `(${ok} ok, ${failed} failed). Total instances: ${this.creatures.length}` +
      (failures.length ? `. Missing: ${failures.join(', ')}` : ''));
  }

  _loadAsset(assetInfo, outCreatures, isSchooling) {
    const filename = assetInfo.filename;
    const category = assetInfo.category;
    // Lifecycle trace (§4): the classification is decided up-front by the manifest.
    console.log(
      `[Creature] loading: ${filename} — classification ${category} ` +
      `(dir=${assetInfo.directory}, ${isSchooling ? 'schooling' : 'individual'})`);
    return new Promise((resolve, reject) => {
      this.loader.load(assetInfo.url, async (gltf) => {
        try {
          const targetSize = this.getTargetSize(category, filename, assetInfo.directory);
          const spawnCount = this.getSpawnCount(assetInfo);

          // Apply category-based visual scale
          const rawModel = gltf.scene;
          rawModel.traverse((obj) => {
            if (obj.isMesh) {
              obj.frustumCulled = false;
              // Underwater scientific visualization: neutralize any emissive
              // contribution baked into the supplied GLB so organisms are lit
              // ONLY by the submarine torch and are never self-luminous (this is
              // what stopped the jelly from glowing on its own). We preserve the
              // asset's albedo/base-color map, normals, roughness and metalness
              // untouched — only the emissive term is zeroed. No material is
              // replaced or recoloured.
              const mats = Array.isArray(obj.material)
                ? obj.material
                : (obj.material ? [obj.material] : []);
              for (const m of mats) {
                if (m && m.emissive) {
                  m.emissive.setRGB(0, 0, 0);
                  if ('emissiveIntensity' in m) m.emissiveIntensity = 0;
                  m.needsUpdate = true;
                }
              }
            }
            if (obj.isSkinnedMesh) {
              try {
                obj.bind(obj.skeleton, obj.bindMatrix);
                obj.normalizeSkinWeights();
              } catch (e) {}
            }
          });

          // Locomotion clip is picked up-front: it is also used to pose the
          // skeleton for a representative (skin-aware) bounds measurement.
          const swimClip = findSwimClip(gltf.animations);

          // Measure and normalize scale.
          // IMPORTANT: THREE.Box3.setFromObject() reads only the raw geometry
          // 'position' attribute and IGNORES skinning. Many rigged reef-fish /
          // jelly GLBs author their geometry in a near-degenerate local space
          // (~0.001-0.012 u) and rely on the skeleton/animation to pose them to
          // real size, so the bind-pose box massively under-measures them and the
          // normalization scale explodes (600-1400x -> giant fish once the swim
          // clip poses the rig at runtime). _measureModel() therefore measures the
          // POSED, skin-aware world bounds (reproducing the GPU skinning path via
          // SkinnedMesh.getVertexPosition) and uses the larger of that and the
          // static box. Rigid models are unaffected (posed == static).
          const measure = this._measureModel(rawModel, swimClip);
          const maxDim = measure.chosenMax;
          const scale = maxDim > 0 ? targetSize / maxDim : 1.0;

          // §20/§6/§11: report the MEASURED posed world-space bbox and the final
          // on-screen size so the size hierarchy is verifiable at runtime (not
          // asserted). Final largest dimension ≈ targetSize by construction
          // (scale × maxDim), so this line also prints the effective hierarchy:
          // small reef ~2.2-3.4 m ≪ fish 3.8 ≪ large_fish 8 ≪ shark 20 ≪ orca 30 ≪ whale 60.
          console.log(
            `[CreatureLoader] "${filename}" (${category}/${assetInfo.directory}) ` +
            `measured posed maxDim ${maxDim.toFixed(3)} u [bind ${measure.bindMax.toFixed(3)}, ` +
            `posed ${measure.posedMax.toFixed(3)}] → target ${targetSize.toFixed(2)} m ` +
            `→ scale ${scale.toFixed(4)} → final ~${(maxDim * scale).toFixed(2)} m largest dim.`);

          // §15: numeric size verification. Report the measured raw/posed bounding
          // box, the fit scale, and the FINAL world-space length (max horizontal)
          // and height (vertical) after scaling — actual proof of the hierarchy,
          // once per species. Species identity is appended after async resolve.
          const mSize = (measure.posedSize && measure.posedSize.lengthSq() > 1e-9)
            ? measure.posedSize : measure.bindSize;
          const finalLength = Math.max(mSize.x, mSize.z) * scale;
          const finalHeight = mSize.y * scale;
          if (!this._loggedScaleFor) this._loggedScaleFor = new Set();
          if (!this._loggedScaleFor.has(filename)) {
            this._loggedScaleFor.add(filename);
            console.log(
              `[CreatureScale] "${filename}" category=${category} ` +
              `biologicalTarget=${targetSize.toFixed(2)}m rawBBox=${measure.bindMax.toFixed(3)}u ` +
              `posedBBox=${measure.posedMax.toFixed(3)}u fitScale=${scale.toFixed(4)} ` +
              `finalLength=${finalLength.toFixed(2)}m finalHeight=${finalHeight.toFixed(2)}m (species pending)`);
          }

          // Intelligence profile resolution (async): GLB filename -> Gemini ->
          // WoRMS/FishBase/OBIS -> KnowledgeProfile (cached). Non-blocking; the
          // creature renders immediately and gets `species` when this resolves.
          const profilePromise = KnowledgeBuilder.buildProfile(filename);

          // Create spawn cluster center
          const centerPos = this._getSpawnPosition(category, isSchooling);

          // Spawn creatures
          for (let k = 0; k < spawnCount; k++) {
            const creatureGroup = SkeletonUtils.clone(rawModel);
            creatureGroup.scale.setScalar(scale);
            creatureGroup.updateMatrixWorld(true);

            const boundingBox = new THREE.Box3().setFromObject(creatureGroup);
            const sphere = new THREE.Sphere();
            boundingBox.getBoundingSphere(sphere);
            const collisionRadius = Math.max(0.6, Math.min(sphere.radius, 16.0));
            const avoidanceRadius = collisionRadius * 1.5;

            // Position with variation
            let px = centerPos.x;
            let py = centerPos.y;
            let pz = centerPos.z;
            if (k > 0) {
              const spread = isSchooling ? 15 : 8;
              px += (Math.random() - 0.5) * spread;
              py += (Math.random() - 0.5) * (isSchooling ? 5 : 2);
              pz += (Math.random() - 0.5) * spread;
              py = Math.min(-3.0, Math.max(-148.0, py));
            }

            creatureGroup.position.set(px, py, pz);
            const initialHeading = Math.random() * Math.PI * 2;
            creatureGroup.rotation.y = initialHeading;
            this.group.add(creatureGroup);

            // Animation mixer
            let mixer = null;
            if (swimClip) {
              mixer = new THREE.AnimationMixer(creatureGroup);
              const action = mixer.clipAction(swimClip);
              action.setLoop(THREE.LoopRepeat, Infinity);
              action.timeScale = 1.0 + Math.random() * 0.5;
              action.time = Math.random() * swimClip.duration;
              action.play();
            }

            // Initial velocity
            const initSpeed = 3.0 * (0.8 + Math.random() * 0.4);
            const initialVelocity = new THREE.Vector3(
              Math.sin(initialHeading) * initSpeed,
              (Math.random() - 0.5) * 0.2,
              Math.cos(initialHeading) * initSpeed
            );

            const initialDepthEnv = KnowledgeBuilder.resolveDepthEnvelope(null, category);
            const creatureObj = {
              name: filename,
              instanceId: `${filename}_${k}`,
              model: creatureGroup,
              mixer,
              speed: 3.0,
              turnRate: 0.05,
              category,
              velocity: initialVelocity,
              targetPos: new THREE.Vector3(px, py, pz),
              collisionRadius,
              avoidanceRadius,
              speedVariation: 0.9 + Math.random() * 0.2,
              schoolSpeciesKey: isSchooling ? filename : null,
              species: null,
              // §5: retained so a later taxonomy-driven size promotion can
              // re-derive scale from the SAME measured posed dimension used here.
              _chosenMax: maxDim,
              _targetSize: targetSize,
              // §15: measured posed world-space size vector (unscaled). Kept so the
              // resolve/promotion diagnostics can recompute the FINAL length/height.
              _posedSize: mSize.clone(),
              minDepth: initialDepthEnv.minDepth,
              maxDepth: initialDepthEnv.maxDepth,
              preferredDepth: initialDepthEnv.preferredDepth,
              depthEnvelope: initialDepthEnv,
              depthTolerance: 10.0,
              // Independent phase and timing offsets for asynchronous natural swimming
              phase: Math.random() * Math.PI * 2,
              verticalTiming: 2.5 + Math.random() * 3.5,
              wanderTiming: 12.0 + Math.random() * 10.0,
              turnTiming: 1.0 + Math.random() * 2.0,
              markedForConsumption: false,
              consumedBy: null
            };

            // Wire resolved intelligence profile. When biology resolves, promote
            // the creature to its taxonomic size class (§5) — increase only.
            profilePromise.then(profile => {
              if (!profile) return;
              creatureObj.species = profile;
              this._applyBiologicalSize(creatureObj, profile);
              const resolvedDepthEnv = KnowledgeBuilder.resolveDepthEnvelope(profile, category);
              creatureObj.minDepth = resolvedDepthEnv.minDepth;
              creatureObj.maxDepth = resolvedDepthEnv.maxDepth;
              creatureObj.preferredDepth = resolvedDepthEnv.preferredDepth;
              creatureObj.depthEnvelope = resolvedDepthEnv;

              // §15 resolve-time verification: identity + taxonomy are now known
              // and any biological size promotion has been applied, so log the
              // FINAL measured world-space size TOGETHER with the resolved species
              // (once per species). This ties the on-screen size hierarchy to a
              // real, tool-grounded identity — an ambiguous/unresolved asset is
              // labelled as such, never given an invented name.
              if (!this._loggedScaleResolvedFor) this._loggedScaleResolvedFor = new Set();
              if (!this._loggedScaleResolvedFor.has(filename)) {
                this._loggedScaleResolvedFor.add(filename);
                const id = profile.identity || {};
                const ps = creatureObj._posedSize;
                const finalScale = creatureObj._chosenMax > 0
                  ? creatureObj._targetSize / creatureObj._chosenMax : 1;
                const len = ps ? Math.max(ps.x, ps.z) * finalScale : (creatureObj._targetSize || 0);
                const ht = ps ? ps.y * finalScale : 0;
                const who = id.commonName || id.displayName ||
                  (id.ambiguous ? 'ambiguous/unresolved' : 'unresolved');
                const sci = id.scientificName || (id.ambiguous ? '—' : 'not resolved');
                console.log(
                  `[CreatureScale] "${filename}" resolved=${who} (${sci}) category=${category} ` +
                  `finalTarget=${(creatureObj._targetSize || 0).toFixed(2)}m ` +
                  `finalLength=${len.toFixed(2)}m finalHeight=${ht.toFixed(2)}m`);
              }
            });

            this.creatures.push(creatureObj);
            this.registry.register(creatureObj);
            this.ecosystemAI.registerCreature(creatureObj);
            outCreatures.push(creatureObj);
          }

          this.loadedCount++;
          console.log(
            `[Creature] loaded: ${filename} — spawn count ${spawnCount}, ` +
            `spawned ${spawnCount} instance(s) (${category}/${assetInfo.directory})`);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, undefined, reject);
    });
  }

  // §5: promote a creature's visual size to its biological size class once the
  // resolved KnowledgeProfile confirms a large taxon (e.g. a cetacean). Driven
  // ENTIRELY by taxonomy — never a filename check, never a hardcoded per-species
  // constant. The promotion only ever INCREASES size (never shrinks) and
  // re-derives scale from the SAME measured posed world-space dimension used at
  // load, so an orca that (mis)detected as a generic 'fish' is corrected up to
  // the giant-cetacean class. Correctly-detected megafauna are already at/above
  // the floor, so this is a no-op for them.
  _applyBiologicalSize(creatureObj, profile) {
    const floor = this._biologicalSizeFloor(profile);
    if (!(floor > 0) || !(creatureObj._chosenMax > 0)) return;
    if (floor <= (creatureObj._targetSize || 0) + 1e-3) return; // increase only; skip no-ops

    const oldTarget = creatureObj._targetSize || 0;
    const ratio = oldTarget > 0 ? floor / oldTarget : 1;
    const newScale = floor / creatureObj._chosenMax;

    creatureObj.model.scale.setScalar(newScale);
    creatureObj.model.updateMatrixWorld(true);
    creatureObj._targetSize = floor;
    // Keep steering radii consistent with the enlarged world size.
    if (creatureObj.collisionRadius) creatureObj.collisionRadius = Math.min(creatureObj.collisionRadius * ratio, 40.0);
    if (creatureObj.avoidanceRadius) creatureObj.avoidanceRadius = creatureObj.collisionRadius * 1.5;

    const c = profile.classification || {};
    console.log(
      `[Creature] size promoted: ${creatureObj.name} ${oldTarget.toFixed(2)} m → ${floor.toFixed(2)} m ` +
      `(taxonomy class=${c.class || '?'} order=${c.order || '?'} family=${c.family || '?'} genus=${c.genus || '?'})`);

    // §15: prove the promotion numerically — the creature's ACTUAL measured
    // world-space size from its stored posed bbox × the new scale, not just the
    // target figure. This is what makes a mis-detected orca/whale verifiably
    // gigantic after taxonomy resolves.
    const ps = creatureObj._posedSize;
    if (ps) {
      const len = Math.max(ps.x, ps.z) * newScale;
      const ht = ps.y * newScale;
      console.log(
        `[CreatureScale] promoted "${creatureObj.name}" → finalTarget=${floor.toFixed(2)}m ` +
        `finalLength=${len.toFixed(2)}m finalHeight=${ht.toFixed(2)}m ` +
        `(class=${c.class || '?'} genus=${c.genus || '?'})`);
    }
  }

  // Map AUTHORITATIVE TAXONOMY (from the resolved KnowledgeProfile) to a minimum
  // visual size class, reusing the CATEGORY_TARGET_SIZE ladder. Returns 0 when
  // taxonomy is unknown/unresolved (-> no promotion, keep the load-time category
  // size). This is biology-driven classification, not a species-name rule: genus
  // Orcinus resolves to the orca class via its Delphinidae/Cetacea taxonomy.
  _biologicalSizeFloor(profile) {
    const c = (profile && profile.classification) || {};
    const cls = String(c.class || '').toLowerCase();
    const order = String(c.order || '').toLowerCase();
    const family = String(c.family || '').toLowerCase();
    const genus = String(c.genus || '').toLowerCase();

    // Bounded modulation by REAL body length when the resolved profile supplies
    // it (morphology.lengthMeters, sourced from FishBase/WoRMS — never fabricated,
    // null when unknown). The category ladder stays the anchor; length only nudges
    // WITHIN a class so a blue whale (~28 m) reads clearly larger than a humpback
    // (~14 m) and different whale GLBs are independently sized (§12) instead of all
    // snapping to one identical number. f is clamped to [0.85, 1.7] so a single
    // outlier length can neither collapse nor explode the hierarchy; refMeters is a
    // representative length for that class. Combined with the increase-only
    // promotion, this only ever makes a large animal larger, never smaller.
    const lengthM = (profile && profile.morphology &&
      typeof profile.morphology.lengthMeters === 'number' && profile.morphology.lengthMeters > 0)
      ? profile.morphology.lengthMeters : null;
    const tier = (base, refMeters) => {
      if (!(lengthM > 0) || !(refMeters > 0)) return base;
      const f = Math.max(0.85, Math.min(1.7, lengthM / refMeters));
      return base * f;
    };

    // Cetaceans (marine mammals) -> sized as cetaceans, never as reef fish.
    const cetFam = ['balaen', 'physeter', 'delphin', 'ziphi', 'eschricht', 'kogi', 'monodont', 'phocoen', 'inii', 'platanist'];
    const isCetacean = cls.includes('mammalia') || order.includes('cetacea') || cetFam.some(s => family.includes(s));
    if (isCetacean) {
      const bigWhaleFam = ['balaen', 'physeter', 'eschricht', 'ziphi', 'kogi'].some(s => family.includes(s));
      const bigWhaleGenus = ['physeter', 'balaenoptera', 'megaptera', 'eubalaena', 'eschrichtius', 'balaena'].includes(genus);
      if (bigWhaleFam || bigWhaleGenus) return tier(CATEGORY_TARGET_SIZE.whale, 18); // 60 base — great whales (blue/fin push above)
      if (genus === 'orcinus') return tier(CATEGORY_TARGET_SIZE.orca, 8);            // 30 base — killer whale (giant delphinid)
      return tier(CATEGORY_TARGET_SIZE.dolphin, 3);                                 // 9 base — other dolphins / generic cetacean
    }

    // Cartilaginous fish -> shark / ray classes (well above bony reef fish).
    if (cls.includes('chondrichthyes') || cls.includes('elasmobranch')) {
      if (order.includes('myliobatiformes') || order.includes('rajiformes') || order.includes('torpediniformes'))
        return tier(CATEGORY_TARGET_SIZE.stingray, 2.5); // 7 base — rays
      return tier(CATEGORY_TARGET_SIZE.shark, 4);        // 20 base — sharks (whale shark pushes above)
    }

    return 0; // unknown taxonomy -> no floor
  }

  // Union sampled, skin-aware WORLD-space vertex positions into `box`.
  // For a SkinnedMesh, getVertexPosition() reproduces the GPU vertex-shader
  // skinning path, so (posed vertex) x matrixWorld == the ACTUAL rendered
  // position. Sampled (<= ~400 verts/mesh) to stay cheap even for dense models.
  _samplePosedWorldBox(root, box) {
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      const count = pos.count;
      const stride = Math.max(1, Math.floor(count / 400));
      if (o.isSkinnedMesh && typeof o.getVertexPosition === 'function') {
        for (let i = 0; i < count; i += stride) {
          o.getVertexPosition(i, _sampleVec);
          _sampleVec.applyMatrix4(o.matrixWorld);
          box.expandByPoint(_sampleVec);
        }
      } else {
        for (let i = 0; i < count; i += stride) {
          _sampleVec.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          box.expandByPoint(_sampleVec);
        }
      }
    });
    return box;
  }

  // Measure a model's normalization dimension. Returns { bindMax, posedMax,
  // chosenMax }. bindMax = legacy Box3.setFromObject (ignores skinning).
  // posedMax = skin-aware bounds sampled while the skeleton is posed to a couple
  // of animation phases (bind pose alone == the degenerate geometry box, which
  // is exactly what under-measured tiny-authored rigs). chosenMax = the larger,
  // so a rig is never under-measured -> normalization no longer explodes.
  _measureModel(root, clip) {
    root.updateMatrixWorld(true);

    const bindBox = new THREE.Box3().setFromObject(root);
    const bindSize = new THREE.Vector3();
    bindBox.getSize(bindSize);
    const bindMax = Math.max(bindSize.x, bindSize.y, bindSize.z);

    const posedBox = new THREE.Box3();
    posedBox.makeEmpty();
    let mixer = null, action = null;
    if (clip) {
      mixer = new THREE.AnimationMixer(root);
      action = mixer.clipAction(clip);
      action.play();
    }
    // Bind pose (phase 0) equals the degenerate geometry box for these rigs, so
    // sample mid-animation phases where the skeleton actually poses the mesh.
    const phases = clip ? [0.3, 0.6] : [0.0];
    for (const ph of phases) {
      if (action) {
        action.time = ph * clip.duration;
        mixer.update(0);
        root.updateMatrixWorld(true);
      }
      this._samplePosedWorldBox(root, posedBox);
    }
    // Reset the shared rawModel skeleton back to bind pose so the per-instance
    // SkeletonUtils.clone()s start clean.
    if (action) action.stop();
    if (mixer) mixer.stopAllAction();
    root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.pose(); });
    root.updateMatrixWorld(true);

    const posedSize = new THREE.Vector3();
    posedBox.getSize(posedSize);
    const posedMax = Math.max(posedSize.x, posedSize.y, posedSize.z);

    const chosenMax = Math.max(bindMax, posedMax);
    // posedSize/bindSize are returned so callers can report the FINAL world-space
    // length (max horizontal extent) and height (y) after scaling, for the
    // [CreatureScale] numeric verification (§15).
    return { bindMax, posedMax, chosenMax, posedSize: posedSize.clone(), bindSize: bindSize.clone() };
  }

  _getSpawnPosition(category, isSchooling) {
    // Spread spawn positions across the ocean. Concentrated from 150 -> 90 so
    // the ecosystem sits within a readable distance of the camera: creatures are
    // already correctly world-sized (whale ~60 m, orca ~30 m, shark ~20 m, reef
    // fish ~2.2-3.4 m), but at the old ±150 dispersion most spawned 120-250 world
    // units away and therefore projected to a few pixels. This is a world-scale
    // concentration, NOT moving creatures toward the camera per-frame and NOT
    // changing depth.
    const range = 90;
    const depthRanges = {
      whale:       { base: -40, spread: 25 },
      orca:        { base: -28, spread: 20 },
      shark:       { base: -35, spread: 25 },
      hammerhead:  { base: -30, spread: 20 },
      dolphin:     { base: -8, spread: 8 },
      manta:       { base: -25, spread: 15 },
      large_fish:  { base: -32, spread: 20 },
      stingray:    { base: -135, spread: 10 },
      sea_turtle:  { base: -12, spread: 10 },
      octopus:     { base: -140, spread: 8 },
      jellyfish:   { base: -22, spread: 18 },
      fish:        { base: -12, spread: 14 },
      default:     { base: -15, spread: 16 }
    };

    const depthInfo = depthRanges[category] || depthRanges.default;
    const x = (Math.random() - 0.5) * range * 2;
    const y = depthInfo.base + (Math.random() - 0.5) * depthInfo.spread;
    const z = (Math.random() - 0.5) * range * 2;

    return new THREE.Vector3(x, y, z);
  }
}