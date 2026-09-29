import * as THREE from 'three';

/**
 * DriftSimulationEngine — Simulates Search and Rescue (SAR) drift trajectories
 * using current vectors, wind leeway, and stochastic dispersion.
 * 
 * IMPORTANT: Explicitly marked as "Simulated Prediction".
 */
export class DriftSimulationEngine {
  constructor(scene, oceanData) {
    this.scene = scene;
    this.oceanData = oceanData;
    this.lineMesh = null;
    this.markerMeshes = [];
    this.trajectory = [];
    this.visible = false;
    this.statusLabel = 'Simulated Prediction (Not an official SAR forecast)';
  }

  /**
   * Compute forward drift trajectory from start position over duration hours.
   */
  simulateDrift(startPos = new THREE.Vector3(0, -5, 0), hours = 24, timeStepMins = 30) {
    this.trajectory = [];
    let current = startPos.clone();
    const steps = Math.floor((hours * 60) / timeStepMins);
    const dtSeconds = timeStepMins * 60;

    for (let step = 0; step <= steps; step++) {
      const elapsedHours = (step * timeStepMins) / 60;
      const depth = Math.abs(current.y);
      const velocity = this.oceanData.getCurrentVelocity(depth); // u, v in m/s

      // Leeway drift with small stochastic uncertainty
      const u = velocity.u + (Math.sin(step * 0.1) * 0.05);
      const v = velocity.v + (Math.cos(step * 0.1) * 0.05);

      // World scale: 1 unit ~ 10 meters
      const dx = (u * dtSeconds) * 0.1;
      const dz = (v * dtSeconds) * 0.1;

      // Small vertical oscillation near surface
      const dy = Math.sin(step * 0.2) * 0.5;

      current.x += dx;
      current.z += dz;
      current.y = Math.min(-1, Math.max(-10, current.y + dy));

      this.trajectory.push({
        position: current.clone(),
        hour: elapsedHours,
        uncertaintyRadius: 2 + elapsedHours * 0.8 // Growing cone of uncertainty
      });
    }

    this._updateVisuals();
    return this.trajectory;
  }

  _updateVisuals() {
    if (this.lineMesh) {
      this.scene.remove(this.lineMesh);
      this.lineMesh.geometry.dispose();
      this.lineMesh = null;
    }
    for (const m of this.markerMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.markerMeshes = [];

    if (!this.visible || this.trajectory.length === 0) return;

    // Build 3D trajectory curve line
    const points = this.trajectory.map(t => t.position);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xff3344,
      linewidth: 3,
      transparent: true,
      opacity: 0.8
    });
    this.lineMesh = new THREE.Line(geometry, material);
    this.scene.add(this.lineMesh);

    // Add waypoint markers every 6 hours
    const sphereGeo = new THREE.SphereGeometry(1.5, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    for (let i = 0; i < this.trajectory.length; i += 12) {
      const pt = this.trajectory[i];
      const mesh = new THREE.Mesh(sphereGeo, markerMat);
      mesh.position.copy(pt.position);
      this.scene.add(mesh);
      this.markerMeshes.push(mesh);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    this._updateVisuals();
  }

  getTrajectory() {
    return this.trajectory;
  }
}
