export class CreatureMemory {
  constructor() {
    this.perceivedEntities = [];
    this.lastThreat = null;
    this.lastFood = null;
    this.lastInterestingLocation = null;
    
    // Target memory
    this.currentTarget = null; // Vector3 position of current goal/target
    this.currentTargetEntity = null; // Reference to the actual target creature
    this.targetAcquiredTime = 0;
    this.targetLostTime = 0;
    this.lastKnownTargetPosition = null;

    // Wander intent
    this.wanderTarget = null;
    this.wanderTargetSetTime = 0;

    this.lastDecisionTime = 0;
    this.cooldowns = new Map();
  }

  updatePerceived(entities) {
    this.perceivedEntities = entities;
  }

  setCooldown(key, duration, now) {
    this.cooldowns.set(key, now + duration);
  }

  isOnCooldown(key, now) {
    if (!this.cooldowns.has(key)) return false;
    return now < this.cooldowns.get(key);
  }

  clearTarget() {
    this.currentTarget = null;
    this.currentTargetEntity = null;
    this.targetAcquiredTime = 0;
    this.targetLostTime = 0;
    this.lastKnownTargetPosition = null;
  }
}
