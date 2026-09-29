import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Build-safe asset URL (bundled by Vite in dev AND production). The supplied
// container-ship model lives in src/assets/container_Ship/. We only ever LOAD this
// provided file — no geometry is generated to replace it. (Ship audio was removed.)
import shipModelUrl from '../assets/container_Ship/container_ship_3d.glb?url';

/**
 * ContainerShipManager — a single large surface vessel that sails a continuous
 * looping route across the ocean surface and actively steers around every mobile
 * entity in the scene. It is a radar/registry entity and a Codex-focusable VESSEL.
 * (The container ship has NO audio: no AudioListener, PositionalAudio, or proximity
 * audio path exists for it — audio was removed by request.)
 *
 * Provenance / scope:
 *  - This is a SIMULATION / VISUALISATION entity, NOT scientific observation data.
 *    It is tagged `synthetic: true` and kept OUT of the Codex species-resolution
 *    path (main.js feeds it only to the radar list). It never touches Argo / model
 *    field / GeoTransform.
 *  - The GLB (container_ship_3d.glb) is used exactly as supplied. Measured facts:
 *    no animations, identity root, fore-aft = local +X, up = +Y (hull bottom ≈ y0),
 *    beam = local Z. Orientation/heading are therefore code-driven: the model is
 *    pre-rotated so its bow (+X) maps to the app's +Z-forward heading convention.
 */

// --- Tunables (app-level visual/behaviour defaults — not measured/real values) ---
const TARGET_LENGTH = 70;       // world units bow→stern after scaling (large vessel)
const DRAFT_RATIO = 0.11;       // calibrated waterline draft ratio (~1.8m draft below Y=0; deck & containers high & dry)
const BOB_RESPONSE = 2.0;       // vertical-follow easing (per second)
const VESSEL_SPEED = 2.0;       // units/s steady cruise (calibrated reduced speed)
const VESSEL_MIN_SPEED = 1.0;   // units/s when turning hard / avoiding
const VESSEL_MAX_SPEED = 2.4;   // units/s maximum speed
const VESSEL_ACCEL = 0.20;      // smooth acceleration rate
const VESSEL_DECEL = 0.35;      // smooth deceleration rate
const VESSEL_TURN_RATE = 0.30;  // smooth turning rate (rad/s responsiveness)
const WAYPOINT_ARRIVE = 20;     // switch to next waypoint within this XZ distance
const HARD_BOUND_X = 205;       // hard safety clamp (well inside the data extent ±240)
const HARD_BOUND_Z = 150;       //                    (data extent Z ±160)

// Avoidance envelope (Part 6). SAFETY_RADIUS is derived once from the real hull
// half-length so it scales with whatever the GLB proportions are.
const SAFETY_MARGIN = 18;      // clearance added beyond the hull tip
const BROAD_PHASE_EXTRA = 42;  // only entities within (safety + this) XZ are considered
const VERTICAL_GATE = 24;      // ignore entities farther than this above/below the hull
const DEFAULT_ENTITY_RADIUS = 6;
const PREDICT_TIME = 1.6;      // s look-ahead so the ship turns BEFORE overlap
const AVOID_INTERVAL = 0.14;   // s → ~7 Hz avoidance scan (movement stays 60 Hz)

export class ContainerShipManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();

    this.pivot = null;         // THREE.Group: holds position + heading (yaw)
    this.entity = null;        // radar/registry entity descriptor
    this.loaded = false;

    this.heading = 0;          // current yaw (radians)
    this.speed = 0;            // current forward speed (units/s)
    this.waypoints = [];
    this.wpIndex = 0;
    this.safetyRadius = 40;    // recomputed from the real bbox at load

    // Scratch objects reused every frame — no per-frame allocation (Part 10).
    this._fwd = new THREE.Vector2();
    this._desired = new THREE.Vector2();
    this._steer = new THREE.Vector2();
    this._avoid = new THREE.Vector2();     // last computed avoidance vector (XZ)
    this._predict = new THREE.Vector3();
    this._avoidClock = 0;
    this._lastGoodPose = null;   // last finite {x,y,z,h} — belt-and-braces for transform safety
  }

  /**
   * Loads the supplied GLB, seats it on the surface with a realistic draft, and builds a
   * large looping route. The ship has NO audio. Safe to await inside the deferred ocean
   * build; failures are logged and swallowed so the rest of the ocean still comes up.
   */
  async load(ocean) {
    try {
      const gltf = await this._loadModel(shipModelUrl);
      if (!gltf || !gltf.scene) return;

      const model = gltf.scene;

      // Scale to a large-vessel length from the model's real fore-aft extent (+X).
      let box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const rawLength = Math.max(size.x, 0.001);
      const scale = TARGET_LENGTH / rawLength;
      model.scale.setScalar(scale);

      // Bake the pre-rotation so the bow (+X) aligns with the app's +Z-forward
      // heading convention (atan2(dir.x, dir.z)). -90° about Y maps +X → +Z.
      model.rotation.y = -Math.PI / 2;
      model.updateMatrixWorld(true);

      // Re-measure in the scaled+rotated frame, then translate the model so its
      // horizontal centre sits at the pivot origin and the chosen waterline sits at
      // y=0. The keel then rides `draft` below the surface; the pivot's y is simply
      // the wave height each frame (moored-buoy idiom).
      box = new THREE.Box3().setFromObject(model);
      const centerX = (box.min.x + box.max.x) / 2;
      const centerZ = (box.min.z + box.max.z) / 2;
      const hullHeight = box.max.y - box.min.y;
      const waterlineY = box.min.y + DRAFT_RATIO * hullHeight;
      model.position.x -= centerX;
      model.position.z -= centerZ;
      model.position.y -= waterlineY;

      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          // Keep default frustum culling (Part 10 — don't disable it globally).
        }
      });

      // Safety envelope from the REAL hull half-length (computed once).
      this.safetyRadius = (TARGET_LENGTH / 2) + SAFETY_MARGIN;

      this.pivot = new THREE.Group();
      this.pivot.name = 'ContainerShip';
      this.pivot.add(model);

      // Build the looping route and drop the ship onto its first leg.
      this.waypoints = this._buildRoute();
      const start = this.waypoints[0];
      const next = this.waypoints[1 % this.waypoints.length];
      // Waypoints are THREE.Vector2 where .x = world X and .y = world Z (see
      // _buildRoute + the update() reads at wp.y vs pos.z). Use start.y / next.y
      // for the Z component — NOT `.z`, which is undefined on a Vector2 and would
      // make the pose NaN and propagate through the scene graph.
      this.pivot.position.set(start.x, 0, start.y);
      this.heading = Math.atan2(next.x - start.x, next.y - start.y);
      this.pivot.rotation.y = this.heading;
      this.wpIndex = 1;
      this.speed = VESSEL_SPEED * 0.5;
      if (ocean && typeof ocean.heightAt === 'function') {
        this.pivot.position.y = ocean.heightAt(start.x, start.y, 0);
      }

      this.scene.add(this.pivot);

      this.entity = {
        entityType: 'ship',            // Radar keys off this (category==='ship' || entityType==='ship'),
                                       // so radar is UNAFFECTED by the category change below.
        category: 'vessel',            // Resolved as a VESSEL (KnowledgeBuilder vessel branch),
                                       // NOT sent through biological species resolution.
        id: 'CONTAINER-VESSEL-01',
        name: 'InVictus',
        type: 'Container Ship',
        vesselCategory: 'Commercial maritime surface vessel',
        status: 'Active · Simulation entity',
        model: this.pivot,
        position: this.pivot.position,
        synthetic: true,               // simulation entity, not measured data
        dataQuality: 'SIMULATION_ENTITY',
        dataSource: 'Simulation / visualisation (not an ocean observation)',
        // Codex focus range for this large vessel — wider than the default creature
        // interaction radius so the ship is discoverable from a realistic stand-off
        // distance (consumed by OceanCodex as a per-entity radius; creatures without
        // this field keep the default). The ship declares NO audio.
        focusRadius: 90
      };

      this.loaded = true;
      // Diagnostic: report the ACTUAL measured GLB bounds (scaled+rotated frame, world
      // units) and the derived seating, so the waterline is verifiable at runtime rather
      // than assumed. minY/maxY are the hull's vertical extent; waterlineY is the height
      // mapped to the pivot origin (so `draft` sits below the surface, `freeboard` above).
      console.log(
        `[ContainerShip] "InVictus" loaded — scale=${scale.toFixed(3)}, length≈${TARGET_LENGTH}u\n` +
        `  hull bounds (scaled, world u): minY=${box.min.y.toFixed(3)} maxY=${box.max.y.toFixed(3)} hullHeight=${hullHeight.toFixed(3)}\n` +
        `  waterlineY=${waterlineY.toFixed(3)} → mapped to pivot origin; draft≈${(DRAFT_RATIO * hullHeight).toFixed(2)}u below surface, freeboard≈${(box.max.y - waterlineY).toFixed(2)}u above\n` +
        `  safetyR=${this.safetyRadius.toFixed(1)}u`
      );
    } catch (e) {
      console.warn('[ContainerShip] Could not load container_ship_3d.glb:', e.message);
    }
  }

  _loadModel(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  /**
   * Large elliptical loop centred on the origin. rx > the creature envelope (±90) so
   * the route deliberately crosses the populated zone, exercising avoidance, yet stays
   * inside the world/data bounds. Purely a navigation path (not geographic data).
   */
  _buildRoute() {
    const rx = 120, rz = 92, n = 14;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * rz));
    }
    return pts;
  }

  /**
   * Per-frame update. Movement integrates every frame (smooth 60 Hz); the avoidance
   * scan runs at ~7 Hz and only tweaks the steering vector, so motion never jitters.
   * `avoidEntities` is the existing registry list (creatures + instruments + wreck).
   */
  update(dt, time, ocean, avoidEntities) {
    if (!this.loaded || !this.pivot || !dt) return;

    const pos = this.pivot.position;

    // --- Advance the looping route target ---
    let wp = this.waypoints[this.wpIndex];
    const dxw = wp.x - pos.x, dzw = wp.y - pos.z; // wp is Vector2 (x, z-as-y)
    if ((dxw * dxw + dzw * dzw) < WAYPOINT_ARRIVE * WAYPOINT_ARRIVE) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      wp = this.waypoints[this.wpIndex];
    }
    this._desired.set(wp.x - pos.x, wp.y - pos.z);
    if (this._desired.lengthSq() > 1e-6) this._desired.normalize();

    // --- Avoidance scan (throttled) → updates this._avoid (XZ repulsion) ---
    this._avoidClock += dt;
    if (this._avoidClock >= AVOID_INTERVAL) {
      this._avoidClock = 0;
      this._computeAvoidance(avoidEntities, pos);
    }

    // --- Blend desired route heading with avoidance repulsion ---
    this._steer.copy(this._desired);
    const avoidStrength = this._avoid.length();
    if (avoidStrength > 1e-4) {
      // Steer away from threats; the closer/denser they are, the harder the turn.
      const s = Math.min(avoidStrength, 1.6);
      this._steer.addScaledVector(this._avoid.clone().normalize(), 0.5 + 1.3 * s);
      if (this._steer.lengthSq() > 1e-6) this._steer.normalize();
    }

    // --- Smoothly ease heading toward the steering target (no teleport/jitter) ---
    const targetHeading = Math.atan2(this._steer.x, this._steer.y);
    const headErr = this._wrapAngle(targetHeading - this.heading);
    this.heading += headErr * Math.min(1, VESSEL_TURN_RATE * dt);
    this.pivot.rotation.y = this.heading;

    // --- Speed: ease toward cruise, slow for hard turns / strong avoidance ---
    const turnPenalty = Math.min(1, Math.abs(headErr) / 0.9);
    const avoidPenalty = Math.min(1, avoidStrength);
    const targetSpeed = THREE.MathUtils.lerp(
      VESSEL_SPEED, VESSEL_MIN_SPEED, Math.max(turnPenalty, avoidPenalty)
    );
    const rate = targetSpeed > this.speed ? VESSEL_ACCEL : VESSEL_DECEL;
    this.speed = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(this.speed, targetSpeed, Math.min(1, rate * dt)),
      0,
      VESSEL_MAX_SPEED
    );

    // --- Integrate forward along the CURRENT heading (goes where it points) ---
    this._fwd.set(Math.sin(this.heading), Math.cos(this.heading));
    pos.x += this._fwd.x * this.speed * dt;
    pos.z += this._fwd.y * this.speed * dt;

    // Hard safety clamp (route already stays inside; this is belt-and-braces).
    pos.x = THREE.MathUtils.clamp(pos.x, -HARD_BOUND_X, HARD_BOUND_X);
    pos.z = THREE.MathUtils.clamp(pos.z, -HARD_BOUND_Z, HARD_BOUND_Z);

    // Ride the real wave surface (the waterline was baked to the pivot origin), but
    // DAMP the vertical response: a ~70 m vessel should ease toward the surface height,
    // not snap to the instantaneous point wave-height every frame (which reads as
    // unrealistic high-frequency bobbing). ocean.heightAt(x,z,time) is used ONLY as the
    // water-surface reference; the horizontal route/heading above is left unchanged.
    if (ocean && typeof ocean.heightAt === 'function') {
      const targetY = ocean.heightAt(pos.x, pos.z, time);
      if (Number.isFinite(targetY)) {
        pos.y += (targetY - pos.y) * Math.min(1, BOB_RESPONSE * dt);
      }
    }

    // Belt-and-braces finite guard (general transform safety). A non-finite pose
    // component (should never arise — waypoints and easing are guarded above) would
    // corrupt this pivot's world matrix and propagate NaN into the scene graph during
    // renderer.render(). So never let a non-finite pose reach the scene graph: on any
    // bad component, restore the last good pose and halt this frame's motion.
    if (Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z) && Number.isFinite(this.heading)) {
      if (!this._lastGoodPose) this._lastGoodPose = { x: 0, y: 0, z: 0, h: 0 };
      this._lastGoodPose.x = pos.x;
      this._lastGoodPose.y = pos.y;
      this._lastGoodPose.z = pos.z;
      this._lastGoodPose.h = this.heading;
    } else if (this._lastGoodPose) {
      pos.set(this._lastGoodPose.x, this._lastGoodPose.y, this._lastGoodPose.z);
      this.heading = this._lastGoodPose.h;
      this.pivot.rotation.y = this.heading;
      this.speed = 0;
    } else {
      // No good pose captured yet (only if the first frame is already non-finite):
      // pin to a safe origin so no NaN/Infinity can enter the scene graph.
      pos.set(0, 0, 0);
      this.heading = 0;
      this.pivot.rotation.y = 0;
      this.speed = 0;
    }
  }

  /** Accumulate an XZ repulsion vector from nearby, near-surface mobile entities. */
  _computeAvoidance(entities, pos) {
    this._avoid.set(0, 0);
    if (!entities || entities.length === 0) return;

    // Look ahead so we react BEFORE the hull reaches a threat.
    const look = Math.max(this.speed, VESSEL_SPEED) * PREDICT_TIME;
    const px = pos.x + this._fwd.x * look;
    const pz = pos.z + this._fwd.y * look;
    const shipY = pos.y;
    const broad = this.safetyRadius + BROAD_PHASE_EXTRA;
    const broadSq = broad * broad;

    for (const e of entities) {
      if (!e || e === this.entity) continue;
      const ep = e.model ? e.model.position : e.position;
      if (!ep) continue;
      // Vertical gate: a creature far below the surface can't hit a surface ship.
      if (Math.abs(ep.y - shipY) > VERTICAL_GATE) continue;

      const dx = px - ep.x, dz = pz - ep.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > broadSq) continue; // broad-phase reject (squared distance, Part 10)

      const er = e.avoidanceRadius || e.collisionRadius || e.boundingRadius || DEFAULT_ENTITY_RADIUS;
      const trigger = this.safetyRadius + er;
      if (d2 >= trigger * trigger) continue;

      const d = Math.sqrt(d2) || 0.0001;
      const w = (trigger - d) / trigger;      // 0..1, stronger when closer
      this._avoid.x += (dx / d) * w;
      this._avoid.y += (dz / d) * w;
    }
  }

  _wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /** Radar/registry accessors (mirrors ShipwreckManager / InstrumentManager). */
  getEntity() {
    return this.entity;
  }
  getEntities() {
    return this.entity ? [this.entity] : [];
  }
}
