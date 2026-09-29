import * as THREE from 'three';

/**
 * PFZEngine — Potential Fishing Zone Advisory Simulation Engine.
 * 
 * Takes ocean variables (temperature, chlorophyll/productivity gradient, depth)
 * and identifies high-probability pelagic aggregation zones (thermal fronts, upwelling edges).
 * 
 * IMPORTANT: Explicitly marked as "Derived Advisory" / Prototype.
 */
export class PFZEngine {
  constructor(scene, oceanData) {
    this.scene = scene;
    this.oceanData = oceanData;
    this.zones = [];
    this.visualMarkers = [];
    this.visible = false;
    this.statusLabel = 'Derived Advisory (Simulation Prototype)';
  }

  /**
   * Compute candidate PFZ zones based on thermal gradients.
   */
  computePFZ(region = { lat: 12.5, lon: 80.0, radiusKm: 100 }) {
    this.zones = [];

    // Candidate zones based on simulated thermal front edges (SST 27-28.5°C gradient)
    const candidates = [
      { id: 'PFZ-A', lat: 12.8, lon: 80.4, depth: -20, temp: 27.8, chlorophyll: 0.85, confidence: 0.88, species: 'Tuna / Mackerel' },
      { id: 'PFZ-B', lat: 12.2, lon: 79.9, depth: -35, temp: 26.5, chlorophyll: 1.12, confidence: 0.92, species: 'Sardines / Carangids' },
      { id: 'PFZ-C', lat: 13.1, lon: 80.8, depth: -15, temp: 28.2, chlorophyll: 0.65, confidence: 0.74, species: 'Pelagic forage fish' },
    ];

    this.zones = candidates.map(c => ({
      ...c,
      disclaimer: 'Prototype Derived Advisory — Not for official operational navigation',
      timestamp: new Date().toISOString()
    }));

    this._updateVisuals();
    return this.zones;
  }

  _updateVisuals() {
    // Clear old markers
    for (const m of this.visualMarkers) {
      this.scene.remove(m);
    }
    this.visualMarkers = [];

    if (!this.visible) return;

    // Create glowing indicator rings in the 3D scene
    const ringGeo = new THREE.RingGeometry(15, 25, 32);
    ringGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      
      const x = (i - 1) * 160;
      const y = z.depth;
      const zPos = (Math.random() - 0.5) * 200;
      mesh.position.set(x, y, zPos);
      
      this.scene.add(mesh);
      this.visualMarkers.push(mesh);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    this._updateVisuals();
  }

  getZones() {
    return this.zones;
  }
}
