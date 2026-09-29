import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * ArgoManager — Manages Argo float telemetry and visualization.
 * 
 * Strict Asset Policy:
 * - NEVER creates procedural geometry / placeholder cylinders.
 * - Loads actual argo_float.glb if provided in assets.
 * - If GLB is missing, logs status and maintains telemetry data for UI/Codex without fake 3D geometry.
 */
export class ArgoManager {
  constructor(scene) {
    this.scene = scene;
    this.floats = [];
    this.loader = new GLTFLoader();
    this.modelTemplate = null;
    this.loaded = false;
  }

  async init(count = 5) {
    // Attempt to load the real Argo float asset if provided
    try {
      const gltf = await this._loadAsset('/src/assets/instruments/argo_float.glb')
        .catch(() => this._loadAsset('/src/assets/creatures/argo_float.glb'));
      if (gltf && gltf.scene) {
        this.modelTemplate = gltf.scene;
        console.log('[ArgoManager] Loaded argo_float.glb asset successfully');
      }
    } catch (e) {
      console.info('[ArgoManager] Required visual asset not found: argo_float.glb. Visual rendering skipped until asset is provided.');
    }

    this._initFloats(count);
  }

  _loadAsset(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  _initFloats(count) {
    const demoData = [
      { lat: 12.5, lon: 80.2, depth: -40, temp: 28.2, salinity: 34.8, id: 'ARGO-2901001' },
      { lat: 13.1, lon: 79.8, depth: -80, temp: 22.5, salinity: 35.1, id: 'ARGO-2901002' },
      { lat: 11.8, lon: 80.5, depth: -120, temp: 16.8, salinity: 35.4, id: 'ARGO-2901003' },
      { lat: 12.9, lon: 81.0, depth: -25, temp: 29.0, salinity: 34.5, id: 'ARGO-2901004' },
      { lat: 11.5, lon: 79.5, depth: -95, temp: 19.2, salinity: 35.2, id: 'ARGO-2901005' },
    ];

    for (let i = 0; i < Math.min(count, demoData.length); i++) {
      const data = demoData[i];
      const x = (i - 2) * 120 + (Math.random() - 0.5) * 60;
      const z = (Math.random() - 0.5) * 400;
      const y = Math.max(data.depth, -145);

      let model = null;
      if (this.modelTemplate) {
        model = this.modelTemplate.clone();
        model.position.set(x, y, z);
        this.scene.add(model);
      }

      const floatObj = {
        entityType: 'argo',
        entityId: `argo_${i}`,
        name: data.id,
        model, // null if real asset not provided
        position: model ? model.position : new THREE.Vector3(x, y, z),
        depth: data.depth,
        temperature: data.temp,
        salinity: data.salinity,
        timestamp: new Date().toISOString(),
        status: 'active',
        dataSource: 'INCOIS / Argo Program (Telemetry)',
        data,
      };

      this.floats.push(floatObj);
    }
  }

  getFloatInfo(floatObj) {
    return {
      id: floatObj.name,
      depth: `${floatObj.depth} m`,
      temperature: `${floatObj.temperature} °C`,
      salinity: `${floatObj.salinity} PSU`,
      status: floatObj.status,
      dataSource: floatObj.dataSource,
    };
  }

  getEntities() {
    return this.floats;
  }

  update(dt) {
    const t = performance.now() * 0.001;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      const newY = f.depth + Math.sin(t * 0.3 + i * 1.7) * 0.5;
      if (f.model) {
        f.model.position.y = newY;
      }
      f.position.y = newY;
    }
  }
}
