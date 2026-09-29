export class BehaviorProfile {
  constructor() {
    this.movement = {
      movementType: null,
      preferredSpeed: null,
      acceleration: null,
      turnRate: null,
      verticalMobility: null,
      archetype: null // SWIM, SURFACE_SWIM, WHALE_CRUISE, DELPHINID, PATROL, DRIFT, BENTHIC
    };

    this.social = {
      schooling: null,
      groupPreference: null,
      separationStrength: null,
      alignmentStrength: null,
      cohesionStrength: null
    };

    this.habitat = {
      preferredDepth: null,
      depthTolerance: null,
      minDepth: null,
      maxDepth: null,
      habitatType: null,
      canSurface: null,
      surfaceBehavior: null // BREACH, APPROACH, NONE
    };

    this.interaction = {
      predator: null,
      prey: null,
      huntsTaxa: [],
      predatorTaxa: [],
      threatResponse: null, // FLEE, HIDE, IGNORE
      curiosity: null,
      territoriality: null
    };

    this.activity = {
      activityPattern: null,
      exploration: null,
      rest: null
    };
    
    this.simulationDefaults = {
      acceleration: 0.5,
      turnRate: 0.05,
      separationStrength: 1.0,
      alignmentStrength: 1.0,
      cohesionStrength: 1.0
    };

    this.meta = {
      confidence: 'LOW',
      assumptions: [],
      unknowns: [],
      source: null // 'knowledge' or 'category-fallback'
    };
  }
}