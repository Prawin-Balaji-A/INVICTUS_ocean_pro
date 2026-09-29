import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * InstrumentManager — Manages all physical oceanographic instruments.
 *
 * ⚠  DATA-PROVENANCE NOTICE — read before displaying any of these fields.
 * The 3D MODELS are real, user-provided GLB assets (that part is genuine). But
 * every instrument's POSITION, MOTION and TELEMETRY (temperature, salinity,
 * sst, windSpeed, waveHeight, depth, status) is SYNTHETIC animation produced by
 * local formulas/RNG for ambient visualisation — it is NOT measured data and
 * NOT tied to any real network. Accordingly, each entity is tagged
 * `synthetic: true` / `dataQuality: 'SYNTHETIC_ANIMATION'` and its `dataSource`
 * names the synthetic origin (never a real programme/agency). Real observations
 * come only from the Python ingestion service via OceanDataService (INCOIS
 * ERDDAP Argo) and the gridded analysis field — not from this manager.
 *
 * Rules:
 * 1. Strictly uses provided GLB assets from /src/assets/instruments/ (NO procedural models).
 * 2. Spatial Physics (all synthetic ambient motion):
 *    - Moored Buoy: Floats right on the surface (Y = 0) with ocean wave bobbing.
 *    - Argo Floats: Drift freely with deep currents, periodically profiling depth (Y = -5 to -140).
 *    - Ocean Gliders: Roam through the ocean in a sawtooth depth profiling trajectory (Y = -10 to -120).
 *    - Deep-Sea ROV / AUV: Roams in deep water near the seabed (Y = -110 to -145).
 */
/** Label attached to every synthetic instrument's `dataSource`. */
const SYNTHETIC_SOURCE = 'SYNTHETIC ambient animation (not measured/telemetry data)';

export class InstrumentManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.instruments = [];
    this.mixers = [];
  }

  async init(ocean) {
    this.ocean = ocean;

    // Load templates in parallel
    const [buoyGltf, argoGltf, gliderGltf, rovGltf] = await Promise.allSettled([
      this._loadAsset('/src/assets/instruments/moored_buoy.glb'),
      this._loadAsset('/src/assets/instruments/argo_float.glb'),
      this._loadAsset('/src/assets/instruments/glider.glb'),
      this._loadAsset('/src/assets/instruments/rov.glb.glb').catch(() => this._loadAsset('/src/assets/instruments/rov.glb'))
    ]);

    // 1. Surface Moored Oceanographic Buoys (Floats on surface Y = 0)
    if (buoyGltf.status === 'fulfilled' && buoyGltf.value) {
      this._spawnMooredBuoys(buoyGltf.value, 2);
    }

    // 2. Argo Profiling Floats (Drifts with current & profiles depth)
    if (argoGltf.status === 'fulfilled' && argoGltf.value) {
      this._spawnArgoFloats(argoGltf.value, 4);
    }

    // 3. Underwater Gliders (Sawtooth exploration trajectory)
    if (gliderGltf.status === 'fulfilled' && gliderGltf.value) {
      this._spawnGliders(gliderGltf.value, 2);
    }

    // 4. Deep-Sea ROVs / Submersibles (Deep seabed roaming)
    if (rovGltf.status === 'fulfilled' && rovGltf.value) {
      this._spawnDeepROVs(rovGltf.value, 1);
    }

    console.log(`[InstrumentManager] Initialized ${this.instruments.length} ocean instruments from provided GLBs.`);
  }

  _loadAsset(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, (gltf) => {
        if (gltf && gltf.scene) {
          gltf.scene.traverse((obj) => {
            if (obj.isMesh) {
              obj.frustumCulled = false;
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
        }
        resolve(gltf);
      }, undefined, reject);
    });
  }

  _spawnMooredBuoys(gltf, count) {
    const coords = [
      { x: 120, z: -150, id: 'OMNI-BUOY-01', name: 'Moored Met-Ocean Buoy (OMNI)' },
      { x: -180, z: 140, id: 'RAMA-BUOY-04', name: 'RAMA Moored Ocean Buoy' }
    ];

    for (let i = 0; i < Math.min(count, coords.length); i++) {
      const c = coords[i];
      const model = gltf.scene.clone();
      model.scale.setScalar(2.0);
      model.position.set(c.x, 0, c.z);
      this.scene.add(model);

      this._setupMixer(model, gltf.animations);

      const buoy = {
        entityType: 'instrument',
        category: 'buoy',
        id: c.id,
        name: c.name,
        model,
        position: model.position,
        depth: 0,
        sst: 28.6 + (Math.random() - 0.5) * 0.4,
        windSpeed: 12.4 + (Math.random() - 0.5) * 2.0,
        waveHeight: 1.2,
        status: 'Operational (Surface Transmitting)',
        synthetic: true,
        dataQuality: 'SYNTHETIC_ANIMATION',
        dataSource: SYNTHETIC_SOURCE,
        update: (time, dt, ocean) => {
          // Bobs on surface waves
          if (ocean && typeof ocean.heightAt === 'function') {
            const h = ocean.heightAt(model.position.x, model.position.z, time);
            model.position.y = h;
          } else {
            model.position.y = Math.sin(time * 1.5 + i) * 0.3;
          }
          // Slight wave rocking
          model.rotation.z = Math.sin(time * 1.2 + i) * 0.08;
          model.rotation.x = Math.cos(time * 1.1 + i) * 0.08;
        }
      };

      this.instruments.push(buoy);
    }
  }

  _spawnArgoFloats(gltf, count) {
    const profiles = [
      { x: -80, z: -60, startDepth: -30, id: 'ARGO-2901001', name: 'Argo CTD Profiling Float' },
      { x: 140, z: 90, startDepth: -80, id: 'ARGO-2901002', name: 'Argo Deep Profiler' },
      { x: -190, z: 210, startDepth: -110, id: 'ARGO-2901003', name: 'Bio-Argo Sensor Float' },
      { x: 60, z: -220, startDepth: -15, id: 'ARGO-2901004', name: 'Core Argo Float' },
    ];

    for (let i = 0; i < Math.min(count, profiles.length); i++) {
      const p = profiles[i];
      const model = gltf.scene.clone();
      model.scale.setScalar(2.2);
      model.position.set(p.x, p.startDepth, p.z);
      this.scene.add(model);

      this._setupMixer(model, gltf.animations);

      const argo = {
        entityType: 'argo',
        category: 'argo',
        id: p.id,
        name: p.name,
        model,
        position: model.position,
        depth: p.startDepth,
        temperature: 28.0 + p.startDepth * 0.09,
        salinity: 34.5 + Math.abs(p.startDepth) * 0.006,
        status: 'Profiling Cycle',
        synthetic: true,
        dataQuality: 'SYNTHETIC_ANIMATION',
        dataSource: SYNTHETIC_SOURCE,
        targetDepth: p.startDepth,
        cycleTime: i * 15,
        driftDir: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4),
        update: (time, dt) => {
          // Slow vertical profiling cycle (dives to -130m, rises to -2m)
          const cyclePeriod = 60.0; // 60s simulated cycle
          const phase = ((time + argo.cycleTime) % cyclePeriod) / cyclePeriod;
          // Triangle wave between -4m and -130m
          const normDepth = phase < 0.5 ? (phase * 2) : (2 - phase * 2);
          const currentTargetY = -4 - normDepth * 126;

          model.position.y = THREE.MathUtils.lerp(model.position.y, currentTargetY, dt * 0.5);
          
          // Slow current drift
          model.position.x += argo.driftDir.x * dt;
          model.position.z += argo.driftDir.z * dt;

          // Gentle vertical bob
          model.position.y += Math.sin(time * 0.8 + i) * 0.15;

          // Update telemetry
          argo.depth = model.position.y;
          argo.temperature = 28.5 + argo.depth * 0.085;
          argo.salinity = 34.5 + Math.abs(argo.depth) * 0.005;
        }
      };

      this.instruments.push(argo);
    }
  }

  _spawnGliders(gltf, count) {
    const gliders = [
      { x: -120, z: -100, id: 'SLOCUM-GLIDER-01', name: 'Autonomous Slocum Glider' },
      { x: 100, z: 120, id: 'SEAGLIDER-02', name: 'Deep SeaGlider' }
    ];

    for (let i = 0; i < Math.min(count, gliders.length); i++) {
      const g = gliders[i];
      const model = gltf.scene.clone();
      model.scale.setScalar(2.0);
      model.position.set(g.x, -30, g.z);
      this.scene.add(model);

      this._setupMixer(model, gltf.animations);

      const glider = {
        entityType: 'glider',
        category: 'glider',
        id: g.id,
        name: g.name,
        model,
        position: model.position,
        minDepth: -115,
        maxDepth: -8,
        speed: 3.2,
        diveRate: 6.0,
        diving: true,
        direction: new THREE.Vector3(Math.cos(i * 2.0), 0, Math.sin(i * 2.0)).normalize(),
        depth: -30,
        temperature: 24.5,
        salinity: 34.8,
        status: 'Active Sawtooth Mission',
        synthetic: true,
        dataQuality: 'SYNTHETIC_ANIMATION',
        dataSource: SYNTHETIC_SOURCE,
        update: (time, dt) => {
          // Sawtooth dive-and-climb profile
          const vSpeed = glider.diveRate * dt;
          if (glider.diving) {
            model.position.y -= vSpeed;
            if (model.position.y <= glider.minDepth) {
              glider.diving = false;
              glider.direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6);
            }
          } else {
            model.position.y += vSpeed;
            if (model.position.y >= glider.maxDepth) {
              glider.diving = true;
              glider.direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6);
            }
          }

          // Horizontal traversal
          model.position.x += glider.direction.x * glider.speed * dt;
          model.position.z += glider.direction.z * glider.speed * dt;

          // Pitch along dive angle
          const targetPitch = glider.diving ? 0.35 : -0.35;
          model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, targetPitch, dt * 2.0);

          // Yaw towards heading
          const targetYaw = Math.atan2(glider.direction.x, glider.direction.z);
          model.rotation.y = targetYaw;

          glider.depth = model.position.y;
          glider.temperature = 28.5 + glider.depth * 0.085;
          glider.salinity = 34.5 + Math.abs(glider.depth) * 0.005;
        }
      };

      this.instruments.push(glider);
    }
  }

  _spawnDeepROVs(gltf, count) {
    const rovs = [
      { x: 60, z: -100, id: 'DEEP-ROV-HERCULES', name: 'Deep-Sea Research ROV' }
    ];

    for (let i = 0; i < Math.min(count, rovs.length); i++) {
      const r = rovs[i];
      const model = gltf.scene.clone();
      model.scale.setScalar(2.2);
      model.position.set(r.x, -142, r.z); // Near seabed floor
      this.scene.add(model);

      this._setupMixer(model, gltf.animations);

      const rov = {
        entityType: 'rov',
        category: 'rov',
        id: r.id,
        name: r.name,
        model,
        position: model.position,
        speed: 1.2,
        turnRate: 0.03,
        depth: -142,
        targetPos: new THREE.Vector3(r.x, -142, r.z),
        lastTargetTime: 0,
        status: 'Benthic Survey Active',
        synthetic: true,
        dataQuality: 'SYNTHETIC_ANIMATION',
        dataSource: SYNTHETIC_SOURCE,
        update: (time, dt) => {
          // Roam slowly near seabed
          if (time - rov.lastTargetTime > 25.0 || model.position.distanceTo(rov.targetPos) < 5.0) {
            rov.targetPos.set(
              (Math.random() - 0.5) * 200,
              -140 - Math.random() * 6, // Stay near bottom Y = -140 to -146
              (Math.random() - 0.5) * 200
            );
            rov.lastTargetTime = time;
          }

          const dir = new THREE.Vector3().subVectors(rov.targetPos, model.position).normalize();
          model.position.addScaledVector(dir, rov.speed * dt);

          const targetYaw = Math.atan2(dir.x, dir.z);
          model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, targetYaw, dt * 2.0);

          rov.depth = model.position.y;
        }
      };

      this.instruments.push(rov);
    }
  }

  _setupMixer(model, animations) {
    if (animations && animations.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      const clip = animations[0];
      if (clip) {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
      this.mixers.push(mixer);
    }
  }

  getEntities() {
    return this.instruments;
  }

  update(time, dt) {
    for (const inst of this.instruments) {
      if (typeof inst.update === 'function') {
        inst.update(time, dt, this.ocean);
      }
    }
    for (const mixer of this.mixers) {
      mixer.update(dt);
    }
  }
}
