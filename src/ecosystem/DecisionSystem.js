import { TargetSelection } from './TargetSelection.js';
import * as THREE from 'three';

export class DecisionSystem {
  static STATES = {
    WANDER: 'WANDER',
    EXPLORE: 'EXPLORE',
    FLEE: 'FLEE',
    CHASE: 'CHASE',
    ATTACK: 'ATTACK',
    SCHOOL: 'SCHOOL',
    REST: 'REST',
    DRIFT: 'DRIFT',
    SURFACE: 'SURFACE',
    DIVE: 'DIVE',
    CONSUME: 'CONSUME'
  };

  // Archetype-scaled vertical roaming amplitude (metres) for the slow vertical
  // random-walk in updateWanderTarget. Larger = a taller column the animal
  // gradually rises through and descends again; smaller = hugs its home depth.
  // These are presentation ranges (how much of the water column the animal uses),
  // NOT fabricated biological depth limits.
  static VERTICAL_AMPLITUDE = {
    WHALE_CRUISE: 35,
    PATROL:       28,
    DELPHINID:    25,
    SWIM:         18,
    DRIFT:        15,
    SURFACE_SWIM: 12,
    BENTHIC:       8,
  };

  static verticalAmplitude(profile) {
    return this.VERTICAL_AMPLITUDE[profile?.movement?.archetype] ?? 18;
  }

  static decide(creature, memory, profile, now) {
    let nextState = this.STATES.WANDER;
    memory.currentTarget = null;
    
    // 0. If currently executing an active ATTACK lunge (1.2 seconds duration)
    if (memory.attackStartTime && now - memory.attackStartTime < 1200) {
      if (memory.currentTargetEntity && memory.currentTargetEntity.model) {
        memory.currentTarget = memory.currentTargetEntity.model.position.clone();
      }
      return this.STATES.ATTACK;
    } else if (memory.attackStartTime) {
      // Attack just finished -> enter hunting cooldown (18-28s) and clear target
      memory.attackStartTime = null;
      memory.setCooldown('hunting', 18000 + Math.random() * 10000, now);
      memory.clearTarget();
    }

    // 1. CONSUME state after successful attack
    if (memory.consumeStartTime && now - memory.consumeStartTime < 800) {
      return this.STATES.CONSUME;
    } else if (memory.consumeStartTime) {
      memory.consumeStartTime = null;
    }

    // 2. Immediate Threat / FLEE (Prey detecting predator) - HIGHEST PRIORITY
    if (memory.perceivedEntities.length > 0) {
      for (const perceived of memory.perceivedEntities) {
        const otherProfile = perceived.entity.profile;
        if (TargetSelection.isValidPrey(otherProfile, profile)) {
          nextState = this.STATES.FLEE;
          memory.currentTarget = perceived.entity.model.position.clone();
          memory.threatEntity = perceived.entity;
          return nextState;
        }
      }
    }

    // 3. Target Selection / CHASE & ATTACK (Predator lifecycle)
    if (!memory.isOnCooldown('hunting', now)) {
      const targetEntity = TargetSelection.selectTarget(creature, memory, profile, now);
      
      if (targetEntity && targetEntity.model) {
        const myPos = creature.model.position;
        const targetPos = targetEntity.model.position;
        const dist = myPos.distanceTo(targetPos);
        const contactDist = (creature.collisionRadius || 3.0) + (targetEntity.collisionRadius || 1.5) + 1.8;

        // Check if within attack contact distance
        if (dist <= contactDist) {
          nextState = this.STATES.ATTACK;
          memory.attackStartTime = now;
          memory.currentTargetEntity = targetEntity;
          memory.currentTarget = targetPos.clone();
          
          // Mark prey for consumption
          targetEntity.markedForConsumption = true;
          targetEntity.consumedBy = creature;
          
          return nextState;
        }

        nextState = this.STATES.CHASE;
        
        if (memory.currentTargetEntity !== targetEntity) {
          memory.currentTargetEntity = targetEntity;
          memory.targetAcquiredTime = now;
          memory.setCooldown('targetSwitch', 5000, now);
        }
        
        memory.lastKnownTargetPosition = targetPos.clone();
        memory.currentTarget = memory.lastKnownTargetPosition;
        memory.targetLostTime = 0;
        return nextState;
      }
    } else {
      if (memory.currentTargetEntity) {
        memory.clearTarget();
      }
    }
    
    // 4. Surface/Dive behavior for profile-driven animals
    if (profile && this.shouldSurface(creature, profile, memory, now)) {
      return this.STATES.SURFACE;
    }
    
    if (profile && this.shouldDive(creature, profile, memory, now)) {
      return this.STATES.DIVE;
    }

    // 5. Jellyfish / Drifting archetype
    if (profile?.movement?.archetype === 'DRIFT') {
      nextState = this.STATES.DRIFT;
      return nextState;
    }

    // 6. Schooling
    if (profile?.social?.schooling === true) {
      nextState = this.STATES.SCHOOL;
    } else {
      if (memory.perceivedEntities.length > 0 && Math.random() > 0.8) {
        nextState = this.STATES.EXPLORE;
      } else {
        nextState = this.STATES.WANDER;
      }
    }

    if (nextState === this.STATES.WANDER || nextState === this.STATES.EXPLORE || nextState === this.STATES.SCHOOL) {
      this.updateWanderTarget(creature, memory, profile, now);
      memory.currentTarget = memory.wanderTarget;
    }
    
    return nextState;
  }

  static shouldSurface(creature, profile, memory, now) {
    // Only surface-dwelling animals should surface
    if (profile.movement?.archetype !== 'SURFACE_SWIM' && 
        profile.movement?.archetype !== 'WHALE_CRUISE' &&
        profile.movement?.archetype !== 'DELPHINID') {
      return false;
    }
    
    // Don't surface if already near surface
    if (creature.model.position.y > -5) return false;
    
    // Don't surface if on cooldown
    if (memory.isOnCooldown('surface', now)) return false;
    
    // Random surface opportunity
    return Math.random() < 0.002; // ~0.2% chance per decision cycle
  }

  static shouldDive(creature, profile, memory, now) {
    // Only surface-dwelling animals should dive
    if (profile.movement?.archetype !== 'SURFACE_SWIM' && 
        profile.movement?.archetype !== 'WHALE_CRUISE' &&
        profile.movement?.archetype !== 'DELPHINID') {
      return false;
    }
    
    // Dive if near surface and not currently in SURFACE state
    if (creature.model.position.y > -8) {
      // Either been at surface too long or random dive
      if (memory.isOnCooldown('surfaceReached', now) || Math.random() < 0.15) {
        return true;
      }
    }
    
    return false;
  }

  static updateWanderTarget(creature, memory, profile, now) {
    const pos = creature.model.position;
    
    let needsNewTarget = false;
    
    const maxWanderTime = (creature.wanderTiming || 16.0) * 1000;
    if (!memory.wanderTarget) {
      needsNewTarget = true;
    } else {
      const dist = pos.distanceTo(memory.wanderTarget);
      if (dist < 10) needsNewTarget = true;
      if (now - memory.wanderTargetSetTime > maxWanderTime) needsNewTarget = true;
    }

    if (needsNewTarget) {
      const radius = 40 + Math.random() * 45;
      let angle;
      if (Math.hypot(pos.x, pos.z) > 80) {
        // Smoothly steer inward towards open waters
        const toCenter = Math.atan2(-pos.x, -pos.z);
        angle = toCenter + (Math.random() - 0.5) * 0.8;
      } else {
        angle = Math.random() * Math.PI * 2;
      }
      
      const targetX = Math.max(-95, Math.min(95, pos.x + Math.cos(angle) * radius));
      const targetZ = Math.max(-95, Math.min(95, pos.z + Math.sin(angle) * radius));
      
      // --- Continuous smooth vertical movement through depth envelope ---
      const minD = creature.minDepth ?? (profile?.habitat?.minDepth ?? -2.5);
      const maxD = creature.maxDepth ?? (profile?.habitat?.maxDepth ?? -45.0);
      const pref = creature.preferredDepth ?? (profile?.habitat?.preferredDepth ?? (minD + maxD) / 2);

      // Safe bounds within simulation volume: ceiling <= -2.5m, floor >= -146m
      const bandCeiling = Math.min(-2.5, Math.max(minD, maxD));
      const bandFloor = Math.max(-146.0, Math.min(minD, maxD));
      const halfSpan = Math.max(2.0, Math.abs(bandCeiling - bandFloor) * 0.45);

      // Independent vertical wave with creature's unique phase and timing
      const vFreq = 1.0 / (creature.verticalTiming || 3.5);
      const phase = (creature.phase || 0) + (now * 0.001 * vFreq);
      const vNoise = Math.sin(phase) * 0.6 + Math.sin(phase * 0.43 + 1.1) * 0.4;
      
      const targetY = THREE.MathUtils.clamp(pref + vNoise * halfSpan, bandFloor, bandCeiling);
      
      memory.wanderTarget = new THREE.Vector3(targetX, targetY, targetZ);
      memory.wanderTargetSetTime = now;
    }
  }
}