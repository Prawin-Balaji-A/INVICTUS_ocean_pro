import * as THREE from 'three';

/**
 * OceanEnvironment — Centralized environmental boundaries and depth constraints.
 * 
 * Rules:
 * - Ocean surface is Y = 0.
 * - NO underwater creature should ever breach above water surface (Hard ceiling: Y <= -2.0).
 * - Distinguishes between near-surface animals (e.g. Dolphins), pelagic fish, deep-water creatures, and bottom animals (e.g. Rays).
 * - Provides soft repulsion steering so creatures steer away smoothly instead of bouncing against bounds.
 * - Provides hard boundary clamping as an absolute safeguard.
 */
export class OceanEnvironment {
  constructor(surfaceY = 0, floorDepth = 150) {
    this.surfaceY = surfaceY;
    this.floorDepth = floorDepth;
    this.seabedY = -floorDepth;
    this.maxCreatureY = -2.0; // Hard ceiling: slightly below surface so creatures never break through
    this.minCreatureY = this.seabedY + 2.0; // Hard floor: above seabed
  }

  /**
   * Get valid min/max Y bounds for a creature based on its BehaviorProfile.
   */
  getDepthBounds(profile) {
    let maxY = this.maxCreatureY;
    let minY = this.minCreatureY;

    if (profile && profile.habitat) {
      const hab = profile.habitat;
      
      // If profile specifies minDepth (closest to surface, e.g. 1.5m -> -1.5)
      if (hab.minDepth !== null && hab.minDepth !== undefined) {
        maxY = Math.min(this.maxCreatureY, -Math.abs(hab.minDepth));
      }

      // If profile specifies maxDepth (deepest point, e.g. 30m -> -30)
      if (hab.maxDepth !== null && hab.maxDepth !== undefined) {
        minY = Math.max(this.minCreatureY, -Math.abs(hab.maxDepth));
      }

      // If only preferredDepth & depthTolerance exist
      if (hab.preferredDepth !== null && hab.preferredDepth !== undefined && hab.maxDepth === null && hab.minDepth === null) {
        const pref = -Math.abs(hab.preferredDepth);
        const tol = hab.depthTolerance || 15;
        maxY = Math.min(this.maxCreatureY, pref + tol);
        minY = Math.max(this.minCreatureY, pref - tol);
      }
    }

    // Ensure min is below max
    if (minY > maxY) {
      minY = maxY - 5;
    }

    return { minY, maxY };
  }

  /**
   * Generates a smooth steering deflection vector if creature is approaching depth boundaries.
   */
  getRepulsionVector(position, profile) {
    const steer = new THREE.Vector3();
    const { minY, maxY } = this.getDepthBounds(profile);
    const margin = 5.0; // Buffer zone for gentle turn-away

    // Approaching ceiling -> steer down
    if (position.y > maxY - margin) {
      const penetration = position.y - (maxY - margin);
      const strength = Math.min(1.0, penetration / margin);
      steer.y -= strength * 3.0;
    }

    // Approaching seabed -> steer up
    if (position.y < minY + margin) {
      const penetration = (minY + margin) - position.y;
      const strength = Math.min(1.0, penetration / margin);
      steer.y += strength * 3.0;
    }

    return steer;
  }

  /**
   * Hard clamp for creature position.
   */
  clampCreaturePosition(creature, profile) {
    if (!creature.model) return;
    const { minY, maxY } = this.getDepthBounds(profile);
    const pos = creature.model.position;
    
    // Strict ocean envelope: absolutely never breach surface (Y <= -2.5m) or seabed floor
    const safeMaxY = Math.min(-2.5, maxY);
    const safeMinY = Math.max(this.minCreatureY, minY);
    if (pos.y > safeMaxY) {
      pos.y = safeMaxY;
      if (creature.velocity && creature.velocity.y > 0) creature.velocity.y = -Math.abs(creature.velocity.y) * 0.3;
    } else if (pos.y < safeMinY) {
      pos.y = safeMinY;
      if (creature.velocity && creature.velocity.y < 0) creature.velocity.y = Math.abs(creature.velocity.y) * 0.3;
    }
  }
}
