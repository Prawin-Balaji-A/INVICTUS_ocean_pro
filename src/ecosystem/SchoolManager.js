import * as THREE from 'three';
import { Steering } from './Steering.js';

/**
 * School - A cohesive, persistent traveling fish school.
 * Each school has its own center, heading, destination, and behavior.
 */
export class School {
  constructor(id, speciesKey, preferredDepth = -20) {
    this.id = id;
    this.speciesKey = speciesKey;
    this.members = [];
    this.center = new THREE.Vector3();
    this.velocity = new THREE.Vector3(1, 0, 0);
    this.targetDestination = new THREE.Vector3();
    this.preferredDepth = Math.min(-3, Math.max(-144, preferredDepth));
    this.travelSpeed = 3.2 + Math.random() * 1.0;
    this.lastDestinationTime = 0;
    this.lastDirectionChange = 0;
    this.schoolRadius = 8 + Math.random() * 4;
    this.threatState = null;
    this.threatDirection = null;
    this.schoolHeading = Math.random() * Math.PI * 2;
    this.schoolHeadingVariance = 0;
    this.pickNewDestination();
  }

  addMember(creature) {
    if (!this.members.includes(creature)) {
      this.members.push(creature);
      creature.school = this;
      creature.speedVariation = 0.88 + Math.random() * 0.24;
      creature.schoolOffset = new THREE.Vector3(
        (Math.random() - 0.5) * this.schoolRadius * 1.5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * this.schoolRadius * 1.5
      );
      creature.phaseOffset = Math.random() * Math.PI * 2;
    }
  }

  removeMember(creature) {
    const idx = this.members.indexOf(creature);
    if (idx !== -1) {
      this.members.splice(idx, 1);
      creature.school = null;
    }
  }

  setThreat(threatEntity, direction) {
    this.threatState = 'FLEEING';
    this.threatDirection = direction;
    this.threatStartTime = performance.now();
    // Scatter the school slightly
    this.schoolRadius *= 1.5;
    for (const member of this.members) {
      member.schoolOffset.multiplyScalar(1.3);
    }
  }

  clearThreat() {
    this.threatState = null;
    this.threatDirection = null;
    this.schoolRadius = Math.max(8, this.schoolRadius / 1.5);
  }

  pickNewDestination() {
    const now = performance.now();

    // Base destination 40-90 units away.
    const dist = 40 + Math.random() * 50;
    let angle;
    // If nearing the simulation boundary, smoothly steer back toward open waters
    if (Math.hypot(this.center.x, this.center.z) > 80) {
      const toCenter = Math.atan2(-this.center.x, -this.center.z);
      angle = toCenter + (Math.random() - 0.5) * 0.8;
    } else {
      angle = this.schoolHeading + (Math.random() - 0.5) * Math.PI;
    }

    let destX = Math.max(-95, Math.min(95, this.center.x + Math.cos(angle) * dist));
    let destZ = Math.max(-95, Math.min(95, this.center.z + Math.sin(angle) * dist));
    
    // Depth within preferred band
    let destY = this.preferredDepth + (Math.random() - 0.5) * 10;
    destY = Math.min(-3.0, Math.max(-145, destY));
    
    this.targetDestination.set(destX, destY, destZ);
    this.lastDestinationTime = now;
    this.destinationAge = 0;
    
    // Update school heading
    const newHeading = Math.atan2(destX - this.center.x, destZ - this.center.z);
    this.schoolHeading = newHeading;
    this.lastDirectionChange = now;
  }

  update(now, dt) {
    if (this.members.length === 0) return;

    // 1. Calculate school center
    this.center.set(0, 0, 0);
    let validCount = 0;
    for (const member of this.members) {
      if (member.model && !member.markedForConsumption) {
        this.center.add(member.model.position);
        validCount++;
      }
    }
    if (validCount === 0) return;
    this.center.divideScalar(validCount);

    // 2. Clear threat after 5 seconds
    if (this.threatState === 'FLEEING' && now - this.threatStartTime > 5000) {
      this.clearThreat();
    }

    // 3. Check if reached destination or timed out (40s max per waypoint)
    const distToTarget = this.center.distanceTo(this.targetDestination);
    const destinationAge = now - this.lastDestinationTime;
    if (distToTarget < 20 || destinationAge > 40000) {
      this.pickNewDestination();
    }

    // 4. School travel direction & velocity
    let travelDir;
    if (this.threatState === 'FLEEING' && this.threatDirection) {
      // Flee from threat
      travelDir = this.threatDirection.clone().normalize();
      this.velocity.lerp(travelDir.multiplyScalar(this.travelSpeed * 1.5), 0.15);
    } else {
      // Normal travel toward destination
      travelDir = new THREE.Vector3().subVectors(this.targetDestination, this.center).normalize();
      this.velocity.lerp(travelDir.multiplyScalar(this.travelSpeed), 0.08);
    }

    // Add slight heading variance for natural movement
    this.schoolHeadingVariance = Math.sin(now * 0.001) * 0.1;

    // 5. Update individual member steering
    for (let i = 0; i < this.members.length; i++) {
      const member = this.members[i];
      if (!member.model || member.markedForConsumption) continue;

      const profile = member.profile || member.species;
      const neighbors = this.members
        .filter(m => m !== member && m.model && !m.markedForConsumption)
        .map(m => ({ entity: m }));

      // Destination vector from this member toward the school's destination
      const toDest = new THREE.Vector3().subVectors(this.targetDestination, member.model.position).normalize();
      const schoolFlowDir = this.velocity.clone().normalize();

      // Dynamic animated offset with gentle swimming wave
      const waveY = Math.sin(now * 0.002 + (member.phaseOffset || 0)) * 1.2;
      const memberOffset = (member.schoolOffset || new THREE.Vector3()).clone();
      memberOffset.y += waveY;

      // Combine destination vector with school flow and gentle local offset
      const travelIntent = toDest.clone().multiplyScalar(1.2).add(schoolFlowDir.multiplyScalar(0.8));
      if (memberOffset.lengthSq() > 0) {
        travelIntent.addScaledVector(memberOffset.clone().normalize(), 0.3);
      }
      travelIntent.normalize();

      // Flocking (separation, alignment, cohesion, travel intent)
      const flockSteering = Steering.flock(member, neighbors, profile || {}, travelIntent);
      
      member.schoolIntent = flockSteering;
      member.schoolDirection = this.velocity.clone();
    }
  }
}

/**
 * SchoolManager - Orchestrates traveling schools across compatible schooling species.
 */
export class SchoolManager {
  constructor() {
    this.schools = [];
    // One cohesive school PER SPECIES. Small species now spawn 7–11 individuals
    // (AssetManifest schoolSize), so this cap must exceed the max spawn count or
    // a single species would be split across two schools. 12 keeps each species'
    // full group together as one school.
    this.maxSchoolSize = 12;
    this.minSchoolSize = 3;
  }

  assignSchools(creatures, profiles) {
    for (const creature of creatures) {
      if (creature.school) continue;
      if (creature.markedForConsumption) continue;

      const profile = profiles.get(creature) || creature.profile || creature.species;
      if (!profile || profile.social?.schooling !== true) continue;

      const speciesKey = creature.schoolSpeciesKey ||
                         profile.identity?.family || 
                         profile.identity?.genus || 
                         profile.identity?.aphiaID || 
                         profile.identity?.scientificName || 
                         creature.category || 
                         'generic_school';

      let school = this.schools.find(s => s.speciesKey === speciesKey && s.members.length < this.maxSchoolSize);

      if (!school) {
        let preferredDepth = -25;
        if (creature.preferredDepth !== undefined && creature.preferredDepth !== null) {
          preferredDepth = creature.preferredDepth;
        } else if (profile.habitat?.preferredDepth) {
          preferredDepth = -Math.abs(profile.habitat.preferredDepth);
        } else if (creature.model) {
          preferredDepth = creature.model.position.y;
        } else if (profile.habitat?.minDepth && profile.habitat?.maxDepth) {
          preferredDepth = -(profile.habitat.minDepth + profile.habitat.maxDepth) / 2;
        }

        school = new School(this.schools.length + 1, speciesKey, preferredDepth);
        if (creature.model) {
          school.center.copy(creature.model.position);
          school.pickNewDestination();
        }
        this.schools.push(school);
      }

      school.addMember(creature);
    }
  }

  update(now, dt) {
    for (const school of this.schools) {
      school.update(now, dt);
    }
    
    // Remove empty schools
    this.schools = this.schools.filter(s => s.members.length > 0);
  }

  removeCreatureFromSchool(creature) {
    if (creature.school) {
      creature.school.removeMember(creature);
      creature.school = null;
    }
  }

  setSchoolThreat(creature, threatEntity) {
    if (creature.school) {
      const direction = new THREE.Vector3()
        .subVectors(creature.model.position, threatEntity.model.position)
        .normalize();
      creature.school.setThreat(threatEntity, direction);
    }
  }

  getSchoolCount() {
    return this.schools.length;
  }

  getActiveSchools() {
    return this.schools;
  }
}