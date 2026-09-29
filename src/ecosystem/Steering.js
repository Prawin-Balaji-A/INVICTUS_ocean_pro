import * as THREE from 'three';

// Reusable vectors to avoid GC pressure in steering calculations
const _steer = new THREE.Vector3();
const _diff = new THREE.Vector3();
const _sum = new THREE.Vector3();
const _finalSteer = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _ali = new THREE.Vector3();
const _coh = new THREE.Vector3();

export class Steering {
  static wander() {
    return new THREE.Vector3(
      (Math.random() - 0.5),
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5)
    ).normalize();
  }

  static seek(creature, targetPos) {
    return new THREE.Vector3().subVectors(targetPos, creature.model.position).normalize();
  }

  static flee(creature, threatPos) {
    return new THREE.Vector3().subVectors(creature.model.position, threatPos).normalize();
  }
  
  static arrive(creature, targetPos, slowRadius = 10) {
    const dir = new THREE.Vector3().subVectors(targetPos, creature.model.position);
    const dist = dir.length();
    if (dist > 0) {
      dir.normalize();
      if (dist < slowRadius) {
        dir.multiplyScalar(dist / slowRadius);
      }
    }
    return dir;
  }
  
  static separate(creature, neighbors, desiredSeparation = 15) {
    _steer.set(0, 0, 0);
    let count = 0;
    for (const neighbor of neighbors) {
      const dist = creature.model.position.distanceTo(neighbor.entity.model.position);
      if (dist > 0 && dist < desiredSeparation) {
        _diff.subVectors(creature.model.position, neighbor.entity.model.position);
        _diff.normalize().divideScalar(dist);
        _steer.add(_diff);
        count++;
      }
    }
    if (count > 0) {
      _steer.divideScalar(count);
    }
    if (_steer.lengthSq() > 0) {
      _steer.normalize();
    }
    return _steer.clone();
  }

  static align(creature, neighbors, neighborDist = 25) {
    _steer.set(0, 0, 0);
    let count = 0;
    for (const neighbor of neighbors) {
      const dist = creature.model.position.distanceTo(neighbor.entity.model.position);
      if (dist > 0 && dist < neighborDist && neighbor.entity.velocity) {
        _steer.add(neighbor.entity.velocity);
        count++;
      }
    }
    if (count > 0) {
      _steer.divideScalar(count);
      _steer.normalize();
    }
    return _steer.clone();
  }

  static cohere(creature, neighbors, neighborDist = 25) {
    _sum.set(0, 0, 0);
    let count = 0;
    for (const neighbor of neighbors) {
      const dist = creature.model.position.distanceTo(neighbor.entity.model.position);
      if (dist > 0 && dist < neighborDist) {
        _sum.add(neighbor.entity.model.position);
        count++;
      }
    }
    if (count > 0) {
      _sum.divideScalar(count);
      return this.seek(creature, _sum);
    }
    return new THREE.Vector3();
  }

  static flock(creature, neighbors, profile = {}, travelIntent = new THREE.Vector3()) {
    const social = profile?.social || {};
    const interactionRadius = social.groupPreference 
      ? Math.max(25, Math.min(50, social.groupPreference * 2))
      : 25;
    const radius = social.interactionRadius || interactionRadius;
    
    // Use reusable vectors instead of creating new ones
    this._separateTo(creature, neighbors, radius * 0.6, _sep);
    this._alignTo(creature, neighbors, radius, _ali);
    this._cohereTo(creature, neighbors, radius, _coh);
    
    const sepWeight = social.separationStrength ?? 1.5;
    const aliWeight = social.alignmentStrength ?? 1.0;
    const cohWeight = social.cohesionStrength ?? 1.0;
    const travelWeight = 1.2;
    
    _finalSteer.set(0, 0, 0);
    _finalSteer.addScaledVector(_sep, sepWeight);
    _finalSteer.addScaledVector(_ali, aliWeight);
    _finalSteer.addScaledVector(_coh, cohWeight);
    _finalSteer.addScaledVector(travelIntent, travelWeight);
    
    if (_finalSteer.lengthSq() > 0) {
      _finalSteer.normalize();
    }
    return _finalSteer.clone();
  }
  
  // Internal helpers that write to provided vectors
  static _separateTo(creature, neighbors, desiredSeparation, outVec) {
    outVec.set(0, 0, 0);
    let count = 0;
    for (const neighbor of neighbors) {
      const dist = creature.model.position.distanceTo(neighbor.entity.model.position);
      if (dist > 0 && dist < desiredSeparation) {
        _diff.subVectors(creature.model.position, neighbor.entity.model.position);
        _diff.normalize().divideScalar(dist);
        outVec.add(_diff);
        count++;
      }
    }
    if (count > 0) {
      outVec.divideScalar(count);
    }
    if (outVec.lengthSq() > 0) {
      outVec.normalize();
    }
  }
  
  static _alignTo(creature, neighbors, neighborDist, outVec) {
    outVec.set(0, 0, 0);
    let count = 0;
    for (const neighbor of neighbors) {
      const dist = creature.model.position.distanceTo(neighbor.entity.model.position);
      if (dist > 0 && dist < neighborDist && neighbor.entity.velocity) {
        outVec.add(neighbor.entity.velocity);
        count++;
      }
    }
    if (count > 0) {
      outVec.divideScalar(count);
      outVec.normalize();
    }
  }
  
  static _cohereTo(creature, neighbors, neighborDist, outVec) {
    outVec.set(0, 0, 0);
    let count = 0;
    for (const neighbor of neighbors) {
      const dist = creature.model.position.distanceTo(neighbor.entity.model.position);
      if (dist > 0 && dist < neighborDist) {
        outVec.add(neighbor.entity.model.position);
        count++;
      }
    }
    if (count > 0) {
      outVec.divideScalar(count);
      outVec.sub(creature.model.position);
      if (outVec.lengthSq() > 0) {
        outVec.normalize();
      }
    }
  }
}