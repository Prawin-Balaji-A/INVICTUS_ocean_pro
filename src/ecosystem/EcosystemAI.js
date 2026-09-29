import { CreatureMemory } from './CreatureMemory.js';
import { Perception } from './Perception.js';
import { DecisionSystem } from './DecisionSystem.js';
import { Steering } from './Steering.js';
import { BehaviorBuilder } from './BehaviorBuilder.js';
import { SchoolManager } from './SchoolManager.js';
import { SpatialHash } from '../performance/SpatialHash.js';
import { OceanEnvironment } from '../environment/OceanEnvironment.js';
import * as THREE from 'three';

let _camPos = new THREE.Vector3();

export class EcosystemAI {
  constructor(oceanEnv = null) {
    this.creatures = [];
    this.memories = new Map();
    this.decisions = new Map();
    this.steeringIntents = new Map();
    this.profiles = new Map();
    this.schoolManager = new SchoolManager();
    this.oceanEnv = oceanEnv || new OceanEnvironment();
    this.decisionIntervalBase = 1200;
    this.enabled = false;
    this.consumedThisFrame = [];
    this.spatialHash = new SpatialHash(30);
    this.lodDistances = { full: 80, medium: 200, low: 400, cull: 600 };
  }

  setCameraPosition(pos) { _camPos.copy(pos); }

  registerCreature(creature) {
    if (this.creatures.includes(creature)) return;
    this.creatures.push(creature);
    const memory = new CreatureMemory();
    memory.lastDecisionTime = 0;
    this.memories.set(creature, memory);
    this.decisions.set(creature, DecisionSystem.STATES.WANDER);
    if (!creature.velocity || creature.velocity.lengthSq() < 0.01) {
      const angle = Math.random() * Math.PI * 2;
      const speed = creature.speed || 2.2;
      creature.velocity = new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
    }
    this.steeringIntents.set(creature, creature.velocity.clone().normalize());
  }

  removeCreature(creature) {
    const idx = this.creatures.indexOf(creature);
    if (idx !== -1) this.creatures.splice(idx, 1);
    this.memories.delete(creature);
    this.decisions.delete(creature);
    this.steeringIntents.delete(creature);
    this.profiles.delete(creature);
    this.schoolManager.removeCreatureFromSchool(creature);
  }

  _getLODLevel(creature) {
    if (!creature.model) return 'cull';
    const dist = creature.model.position.distanceTo(_camPos);
    if (dist < this.lodDistances.full) return 'full';
    if (dist < this.lodDistances.medium) return 'medium';
    if (dist < this.lodDistances.low) return 'low';
    return 'cull';
  }

  update(dt, now, cameraPos = null) {
    if (!this.enabled) return;
    if (cameraPos) _camPos.copy(cameraPos);
    this.consumedThisFrame = [];
    // Populate the spatial hash that Perception actually queries (module-shared).
    // Without this, Perception.perceive() returns [] and no predator/prey detection occurs.
    Perception.buildSpatialHash(this.creatures);
    
    for (const creature of this.creatures) {
      if (!creature.model || creature.markedForConsumption) continue;
      let profile = this.profiles.get(creature);
      if (!profile || (creature.species && creature.species !== profile._sourceKnowledge)) {
        if (creature.species && creature.species.meta && creature.species.movement) {
          profile = creature.species;
        } else {
          profile = BehaviorBuilder.buildFromKnowledge(creature.species, creature.category);
        }
        profile._sourceKnowledge = creature.species;
        this.profiles.set(creature, profile);
        creature.profile = profile;
        // §1: a behaviour profile has just been (re)built from resolved knowledge.
        // Deduped per species-key so it traces the real build without spamming
        // once per instance.
        if (creature.species) {
          this._loggedBehaviorFor = this._loggedBehaviorFor || new Set();
          const key = creature.name || creature.category || 'unknown';
          if (!this._loggedBehaviorFor.has(key)) {
            this._loggedBehaviorFor.add(key);
            const k = creature.species;
            console.log(
              `[Intelligence] BehaviorProfile built: ${key} → archetype ${profile?.movement?.archetype || '?'} ` +
              `(from ${k.identity?.scientificName || k.identity?.commonName || 'knowledge'}, class=${k.classification?.class || '?'})`);
          }
        }
      }
    }

    this.schoolManager.assignSchools(this.creatures, this.profiles);
    this.schoolManager.update(now, dt);

    for (const creature of this.creatures) {
      if (!creature.model) continue;
      if (creature.markedForConsumption) {
        this._handleConsumedCreature(creature, dt);
        continue;
      }
      const lod = this._getLODLevel(creature);
      if (lod === 'cull') continue;
      const memory = this.memories.get(creature);
      const profile = this.profiles.get(creature);
      const decisionInterval = this.decisionIntervalBase + (profile?.simulationDefaults?.decisionInterval || 0);
      if (lod === 'full') {
        if (now - memory.lastDecisionTime > decisionInterval) {
          memory.lastDecisionTime = now;
          const perceptionRadius = Math.min(profile?.social?.perceptionRadius || 50, this.lodDistances.full);
          memory.perceivedEntities = Perception.perceive(creature, this.creatures, perceptionRadius);
          const decision = DecisionSystem.decide(creature, memory, profile, now);
          this.decisions.set(creature, decision);
          if (decision === DecisionSystem.STATES.FLEE && memory.threatEntity) {
            this.schoolManager.setSchoolThreat(creature, memory.threatEntity);
          }
        }
        this._updateMovement(creature, dt, profile);
      } else if (lod === 'medium') {
        if (now - memory.lastDecisionTime > decisionInterval * 2) {
          memory.lastDecisionTime = now;
          memory.perceivedEntities = Perception.perceive(creature, this.creatures, 30);
        }
        this._updateMovementSimple(creature, dt, profile);
      } else {
        this._updateMovementSimple(creature, dt, profile);
      }
    }
    this._processConsumedCreatures();
  }
  _updateMovement(creature, dt, profile) {
    const currentState = this.decisions.get(creature) || DecisionSystem.STATES.WANDER;
    const memory = this.memories.get(creature);
    let intent = this.steeringIntents.get(creature) || (creature.velocity ? creature.velocity.clone().normalize() : new THREE.Vector3(0, 0, 1));
    const school = creature.school;
    if (school && !creature.markedForConsumption) {
      intent = creature.schoolIntent || intent;
    } else {
      switch (currentState) {
        case DecisionSystem.STATES.FLEE:
          if (memory.currentTarget) intent = Steering.flee(creature, memory.currentTarget);
          break;
        case DecisionSystem.STATES.CHASE:
          if (memory.lastKnownTargetPosition) intent = Steering.seek(creature, memory.lastKnownTargetPosition);
          break;
        case DecisionSystem.STATES.ATTACK:
          if (memory.currentTarget) intent = Steering.seek(creature, memory.currentTarget);
          break;
        case DecisionSystem.STATES.SURFACE:
          creature.model.position.y = Math.max(-3, creature.model.position.y - dt * 1.5);
          intent = Steering.seek(creature, new THREE.Vector3(creature.model.position.x, -3, creature.model.position.z));
          break;
        case DecisionSystem.STATES.DIVE:
          intent = Steering.seek(creature, new THREE.Vector3(creature.model.position.x, creature.preferredDepth || -25, creature.model.position.z));
          break;
        default:
          intent = memory.wanderTarget ? Steering.seek(creature, memory.wanderTarget) : Steering.wander();
      }
    }
    this.steeringIntents.set(creature, intent);
    this._applyMovement(creature, dt, profile, currentState, intent);
  }
  
  _updateMovementSimple(creature, dt, profile) {
    const school = creature.school;
    if (school && creature.schoolIntent) {
      this.steeringIntents.set(creature, creature.schoolIntent);
      this._applyMovement(creature, dt, profile, DecisionSystem.STATES.SCHOOL, creature.schoolIntent);
    } else {
      const intent = creature.velocity ? creature.velocity.clone().normalize() : Steering.wander();
      this._applyMovement(creature, dt, profile, DecisionSystem.STATES.WANDER, intent);
    }
  }
  
  _applyMovement(creature, dt, profile, currentState, intent) {
    const baseSpeed = (profile?.movement?.preferredSpeed || creature.speed || 2.2) * (creature.speedVariation || 1.0);
    const stateMultiplier = currentState === DecisionSystem.STATES.FLEE ? 1.8 : currentState === DecisionSystem.STATES.CHASE ? 1.5 : currentState === DecisionSystem.STATES.ATTACK ? 1.6 : 1.0;
    const maxSpeed = baseSpeed * stateMultiplier;
    const accelerationRate = (profile?.movement?.acceleration || profile?.simulationDefaults?.acceleration || 0.5) * (currentState === DecisionSystem.STATES.FLEE ? 2.0 : 1.0);
    const turnRate = (profile?.movement?.turnRate || profile?.simulationDefaults?.turnRate || 0.05) * (currentState === DecisionSystem.STATES.FLEE ? 1.6 : 1.0);

    // Apply gentle environmental boundary repulsion before reaching hard clamps
    const repulsion = this.oceanEnv.getRepulsionVector(creature.model.position, profile);
    if (repulsion.lengthSq() > 0) {
      intent.add(repulsion).normalize();
    }

    // Responsive, natural velocity steering toward intent
    const steerRate = Math.min(1.0, (turnRate * 25.0 + accelerationRate * 4.0) * dt);
    const targetVel = intent.clone().multiplyScalar(maxSpeed);
    creature.velocity.lerp(targetVel, steerRate);

    const minSpeed = Math.max(2.4, baseSpeed * 0.75);
    if (creature.velocity.lengthSq() < minSpeed * minSpeed) {
      if (creature.velocity.lengthSq() < 0.001) creature.velocity.set(0, 0, minSpeed);
      else creature.velocity.normalize().multiplyScalar(minSpeed);
    } else if (creature.velocity.lengthSq() > maxSpeed * maxSpeed) {
      creature.velocity.normalize().multiplyScalar(maxSpeed);
    }

    creature.model.position.addScaledVector(creature.velocity, dt);
    this.oceanEnv.clampCreaturePosition(creature, profile);

    if (creature.velocity.lengthSq() > 0.01) {
      const targetYaw = Math.atan2(creature.velocity.x, creature.velocity.z);
      let yawDelta = targetYaw - creature.model.rotation.y;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      creature.model.rotation.y += yawDelta * turnRate * (dt * 60);
      const pitchTarget = THREE.MathUtils.clamp(-creature.velocity.clone().normalize().y * 0.45, -0.35, 0.35);
      creature.model.rotation.x = THREE.MathUtils.lerp(creature.model.rotation.x, pitchTarget, turnRate * 2.0);
      const bankTarget = THREE.MathUtils.clamp(-yawDelta * 1.8, -0.45, 0.45);
      creature.model.rotation.z = THREE.MathUtils.lerp(creature.model.rotation.z, bankTarget, turnRate * 2.0);
    }
  }

  _handleConsumedCreature(creature, dt) {
    if (!creature.consumedBy || creature.consumedBy.markedForConsumption) {
      if (!creature.consumedBy) this.removeCreature(creature);
      return;
    }
    const predator = creature.consumedBy;
    const predatorPos = predator.model?.position;
    if (!predatorPos) { this.removeCreature(creature); return; }
    creature.model.position.lerp(predatorPos, dt * 4);
    if (creature.model.position.distanceTo(predatorPos) < 2) {
      this.consumedThisFrame.push(creature);
      this.removeCreature(creature);
    }
  }

  _processConsumedCreatures() {}

  getStats() {
    return { totalCreatures: this.creatures.length, schools: this.schoolManager.getSchoolCount(), spatialHash: this.spatialHash.getStats() };
  }
}