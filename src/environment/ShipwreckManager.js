import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Build-safe asset URL: bundled by Vite in BOTH dev and production. The old
// literal '/src/assets/...' runtime path only resolves under `npm run dev`, so a
// production build silently rendered no wreck at all.
import shipwreckUrl from '../assets/bed/shipwreck.glb?url';

/**
 * ShipwreckManager — Loads and anchors the seabed shipwreck asset.
 *
 * Rules:
 * - Scaled up to a major seabed feature (~168m length at scale 88); the exact
 *   dims follow from the supplied GLB's proportions, not a fabricated figure.
 * - Anchored firmly into the seabed sand at Y = -150m (base auto-computed to
 *   rest just below the floor; never floats or sinks excessively).
 * - Sits on the ocean floor, ~140+ meters below the surface.
 */
export class ShipwreckManager {
  constructor(scene, floor) {
    this.scene = scene;
    this.floor = floor;
    this.loader = new GLTFLoader();
    this.shipwreck = null;
    this.loaded = false;
  }

  async load() {
    try {
      const gltf = await this._loadAsset(shipwreckUrl);
      if (gltf && gltf.scene) {
        const model = gltf.scene;
        
        // Seat on the ACTUAL dune surface beneath the wreck's resting spot
        // (world x=38, z=-65) — exactly what the Floor vertex shader renders —
        // not the flat plane base at -depth. Anchoring to flat -depth left the
        // keel below the higher-rendered sand, so the hull sat partly buried.
        const seabedY = this.floor ? this.floor.heightAt(38, -65) : -150;
        const embedding = 1.0;

        // Scale up to a major seabed feature. 120 (was 88) => roughly ~229m
        // length for this GLB's proportions (derived from its measured base
        // dims, not a fabricated figure). The base is re-derived below from the
        // scaled bounds, so it stays anchored on the seabed regardless of scale.
        model.scale.setScalar(120.0);
        model.traverse((obj) => {
          if (obj.isMesh) {
            obj.frustumCulled = false;
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });

        // Dedicated ShipwreckAnchor
        const anchor = new THREE.Group();
        anchor.name = 'ShipwreckAnchor';
        anchor.rotation.y = THREE.MathUtils.degToRad(35); // Realistic resting orientation
        anchor.rotation.z = THREE.MathUtils.degToRad(8);  // Gentle list in seabed sand
        anchor.add(model);
        anchor.updateMatrixWorld(true);

        // Calculate bottom offset so base rests in seabed sand
        const anchorBox = new THREE.Box3().setFromObject(anchor);
        const bottomOffset = anchorBox.min.y - anchor.position.y;
        
        // Position anchor firmly on seabed floor
        anchor.position.set(38, (seabedY - embedding) - bottomOffset, -65);
        anchor.updateMatrixWorld(true);

        // Sanity guard: only reject if the wreck breaches near the surface,
        // which would indicate a real positioning bug (its base is always
        // anchored to the seabed below). A large seabed wreck whose top is still
        // tens of metres under water is valid — the old -75 threshold risked
        // silently deleting the wreck the moment it was scaled up.
        const finalBox = new THREE.Box3().setFromObject(anchor);
        if (finalBox.max.y > -8) {
          console.error('[ShipwreckManager] Shipwreck breaches surface, removing.');
          return;
        }

        this.scene.add(anchor);
        console.log(`[ShipwreckManager] Shipwreck anchored: seabedY=${seabedY.toFixed(1)}, minY=${finalBox.min.y.toFixed(1)}, maxY=${finalBox.max.y.toFixed(1)} (Deep seabed)`);
        // §8 trace: keel seated `embedding` below the real dune surface (seabedY).
        console.log(`[Seabed] shipwreck bottomY=${(seabedY - embedding).toFixed(2)} ` +
          `seabedY=${seabedY.toFixed(2)} offset=${bottomOffset.toFixed(2)}`);

        this.shipwreck = {
          entityType: 'shipwreck',
          category: 'benthic_feature',
          id: 'SHIPWRECK-CARPATHIA',
          name: 'Sunken Galleon Shipwreck',
          model: anchor,
          position: anchor.position,
          depth: Math.abs(anchor.position.y),
          status: 'Historic Artificial Reef',
          dataSource: 'Bathymetric Survey Registry'
        };

        this.loaded = true;
      }
    } catch (e) {
      console.warn('[ShipwreckManager] Could not load shipwreck.glb:', e.message);
    }
  }

  _loadAsset(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  getEntity() {
    return this.shipwreck;
  }
}
