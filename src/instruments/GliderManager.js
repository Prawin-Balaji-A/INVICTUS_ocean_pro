import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * GliderManager — Manages ocean glider telemetry and visualization.
 * 
 * Strict Asset Policy:
 * - NEVER creates procedural geometry.
 * - Loads actual glider.glb if provided in assets.
 * - If GLB is missing, logs status and maintains simulation/telemetry without fake geometry.
 */
export class GliderManager {
  constructor(scene) {
    this.scene = scene;
    this.gliders = [];
    this.loader = new GLTFLoader();
    this.modelTemplate = null;
  }

  async init(count = 2) {
    try {
      const gltf = await this._loadAsset('/src/assets/instruments/glider.glb')
        .catch(() => this._loadAsset('/src/assets/creatures/glider.glb'));
      if (gltf && gltf.scene) {
        this.modelTemplate = gltf.scene;
        console.log('[GliderManager] Loaded glider.glb asset successfully');
      }
    } catch (e) {
      console.info('[GliderManager] Required visual asset not found: glider.glb. Visual rendering skipped until asset is provided.');
    }

    this._initGliders(count);
  }

  _loadAsset(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  _initGliders(count) {
    for (let i = 0; i < count; i++) {
      const x = (i - 0.5) * 200 + (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 300;
      const y = -30;

      let model = null;
      if (this.modelTemplate) {
        model = this.modelTemplate.clone();
        model.position.set(x, y, z);
        this.scene.add(model);
      }

      const glider = {
        entityType: 'glider',
        entityId: `glider_${i}`,
        name: `GLIDER-${1001 + i}`,
        model,
        position: model ? model.position : new THREE.Vector3(x, y, z),
        minDepth: -120,
        maxDepth: -10,
        speed: 2.0,
        diveRate: 5.0,
        direction: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
        diving: true,
        temperature: 0,
        salinity: 0,
        depth: y,
        dataSource: 'Autonomous Glider Fleet (Telemetry)',
      };

      this.gliders.push(glider);
    }
  }

  getEntities() {
    return this.gliders;
  }

  getGliderInfo(glider) {
    return {
      id: glider.name,
      depth: `${glider.depth.toFixed(1)} m`,
      temperature: `${glider.temperature.toFixed(1)} °C`,
      salinity: `${glider.salinity.toFixed(1)} PSU`,
      mode: glider.diving ? 'Diving' : 'Ascending',
      dataSource: glider.dataSource,
    };
  }

  update(dt) {
    for (const g of this.gliders) {
      const verticalSpeed = g.diveRate * dt;
      const currentPos = g.model ? g.model.position : g.position;
      
      if (g.diving) {
        currentPos.y -= verticalSpeed;
        if (currentPos.y <= g.minDepth) {
          g.diving = false;
          g.direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.5);
        }
      } else {
        currentPos.y += verticalSpeed;
        if (currentPos.y >= g.maxDepth) {
          g.diving = true;
        }
      }

      currentPos.x += g.direction.x * g.speed * dt;
      currentPos.z += g.direction.z * g.speed * dt;

      if (g.model) {
        g.model.rotation.z = g.diving ? -0.3 : 0.3;
      }

      g.depth = currentPos.y;
      g.temperature = 28 + g.depth * 0.08;
      g.salinity = 34.5 + Math.abs(g.depth) * 0.005;
    }
  }
}
