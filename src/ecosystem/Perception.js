import * as THREE from 'three';
import { SpatialHash } from '../performance/SpatialHash.js';

// Shared spatial hash for all perception queries
const _spatialHash = new SpatialHash(30);

// Reusable vectors to avoid GC
const _dir = new THREE.Vector3();

export class Perception {
  // Build spatial hash from all creatures - call once per frame before queries
  static buildSpatialHash(creatures) {
    _spatialHash.insertAll(creatures, (c) => c.model?.position);
    return _spatialHash;
  }
  
  static perceive(creature, allCreatures, radius = 50) {
    const perceived = [];
    const pos = creature.model.position;
    
    // Use spatial hash for O(1) cell lookup instead of O(N) iteration
    const nearby = _spatialHash.getNearby2D(pos, radius);
    
    for (const { entity, distance } of nearby) {
      if (entity === creature) continue;

      _dir.subVectors(entity.model.position, pos).normalize();
      
      perceived.push({
        entity: entity,
        distance: distance,
        direction: _dir.clone(),
        depth: entity.model.position.y,
        category: entity.species?.identity?.displayName || 'Unknown'
      });
    }
    
    return perceived;
  }
  
  // Get nearby entities only (faster, for simple distance checks)
  static getNearby(creature, allCreatures, radius = 50) {
    const pos = creature.model.position;
    const nearby = _spatialHash.getNearby2D(pos, radius);
    return nearby
      .filter(n => n.entity !== creature)
      .map(n => n.entity);
  }
}