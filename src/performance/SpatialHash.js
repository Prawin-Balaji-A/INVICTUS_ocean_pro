/**
 * SpatialHash - Efficient spatial partitioning for creature queries
 * 
 * Converts O(N²) creature interactions to O(N) by using a hash grid.
 * Supports 2D (XZ) and 3D queries.
 */

import * as THREE from 'three';

export class SpatialHash {
  constructor(cellSize = 30) {
    this.cellSize = cellSize;
    this.invCellSize = 1.0 / cellSize;
    this.grid = new Map();
    this._cellKey = new THREE.Vector3();
    this._tempVec = new THREE.Vector3();
  }
  
  _hash(x, y, z) {
    const cx = Math.floor(x * this.invCellSize);
    const cy = Math.floor(y * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);
    return `${cx},${cy},${cz}`;
  }
  
  clear() {
    this.grid.clear();
  }
  
  insert(entity, position) {
    const key = this._hash(position.x, position.y, position.z);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key).push(entity);
  }
  
  // Bulk insert multiple entities
  insertAll(entities, getPositionFn) {
    this.clear();
    for (const entity of entities) {
      const pos = getPositionFn(entity);
      if (pos) this.insert(entity, pos);
    }
  }
  
  // Get entities in nearby cells (2D XZ query - faster)
  getNearby2D(position, radius) {
    const results = [];
    const cells = Math.ceil(radius * this.invCellSize);
    const cx = Math.floor(position.x * this.invCellSize);
    const cz = Math.floor(position.z * this.invCellSize);
    const radiusSq = radius * radius;
    
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dz = -cells; dz <= cells; dz++) {
        const key = `${cx + dx},0,${cz + dz}`;
        const cell = this.grid.get(key);
        if (!cell) continue;
        
        for (const entity of cell) {
          const pos = entity.model ? entity.model.position : entity.position;
          if (!pos) continue;
          
          const distSq = (pos.x - position.x) ** 2 + (pos.z - position.z) ** 2;
          if (distSq <= radiusSq) {
            results.push({ entity, distance: Math.sqrt(distSq) });
          }
        }
      }
    }
    
    return results;
  }
  
  // Get entities in nearby cells (3D query)
  getNearby3D(position, radius) {
    const results = [];
    const cells = Math.ceil(radius * this.invCellSize);
    const cx = Math.floor(position.x * this.invCellSize);
    const cy = Math.floor(position.y * this.invCellSize);
    const cz = Math.floor(position.z * this.invCellSize);
    const radiusSq = radius * radius;
    
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        for (let dz = -cells; dz <= cells; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const cell = this.grid.get(key);
          if (!cell) continue;
          
          for (const entity of cell) {
            const pos = entity.model ? entity.model.position : entity.position;
            if (!pos) continue;
            
            const distSq = (pos.x - position.x) ** 2 + (pos.y - position.y) ** 2 + (pos.z - position.z) ** 2;
            if (distSq <= radiusSq) {
              results.push({ entity, distance: Math.sqrt(distSq) });
            }
          }
        }
      }
    }
    
    return results;
  }
  
  // Alias for getNearby2D (common case for fish)
  getNearby(position, radius) {
    return this.getNearby2D(position, radius);
  }
  
  getStats() {
    let total = 0;
    let maxPerCell = 0;
    for (const cell of this.grid.values()) {
      total += cell.length;
      maxPerCell = Math.max(maxPerCell, cell.length);
    }
    return {
      cellCount: this.grid.size,
      totalEntities: total,
      maxPerCell
    };
  }
}