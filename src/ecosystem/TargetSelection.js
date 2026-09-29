export class TargetSelection {
  /**
   * Evaluates if a given candidate is a valid prey for the predator.
   * STRICT ENFORCEMENT: We must NOT assume based on broad 'predator' flags.
   * There must be explicit support in the BehaviorProfile/SpeciesKnowledge.
   */
  static isValidPrey(predatorProfile, candidateProfile) {
    if (!predatorProfile || !candidateProfile) return false;

    // 1. Must be capable of predation
    if (predatorProfile.interaction?.predator !== true) return false;

    // 2. Whales and giant leviathans cannot be hunted
    const candidateArch = candidateProfile.movement?.archetype;
    const predatorArch = predatorProfile.movement?.archetype;
    if (candidateArch === 'WHALE_CRUISE') return false;

    // Retrieve hunt list from predator
    const hunts = predatorProfile.interaction?.huntsTaxa || [];
    if (hunts.length === 0) return false;

    // Candidate information
    const candidateKnowledge = candidateProfile._sourceKnowledge || {};
    const candidateIdentity = candidateKnowledge.identity || {};
    const candidateTax = candidateKnowledge.classification || candidateKnowledge.taxonomy || {};

    const candidateTerms = [
      candidateIdentity.commonName,
      candidateIdentity.displayName,
      candidateIdentity.scientificName,
      candidateIdentity.aphiaId,
      candidateTax.class,
      candidateTax.className,
      candidateTax.order,
      candidateTax.family,
      candidateTax.genus,
      candidateArch
    ]
      .filter(Boolean)
      .map(t => String(t).toLowerCase());

    const predatorKnowledge = predatorProfile._sourceKnowledge || {};
    const predId = predatorKnowledge.identity || {};

    // Do not hunt animals with matching common name or species (self/conspecific)
    if (candidateIdentity.commonName && predId.commonName && candidateIdentity.commonName === predId.commonName) {
      return false;
    }

    // Do not hunt other apex predators (e.g. shark vs shark)
    if (predatorProfile.interaction.predator && candidateProfile.interaction?.predator && (predatorArch === 'PATROL' && candidateArch === 'PATROL')) {
      return false;
    }

    // General teleost fish matching: if predator hunts 'fish' or 'teleostei' and candidate is standard swimming fish
    const huntsFish = hunts.some(h => ['fish', 'teleostei', 'actinopterygii'].includes(h.toLowerCase()));
    if (huntsFish) {
      if (candidateArch === 'SWIM' || candidateTerms.some(t => t.includes('fish') || t.includes('fusilier') || t.includes('tang') || t.includes('discus') || t.includes('surgeon') || t.includes('clownfish') || t.includes('cichlidae') || t.includes('acanthuridae') || t.includes('pomacentridae') || t.includes('caesionidae'))) {
        return true;
      }
    }

    // Specific taxonomic / family / genus / keyword matches
    for (const huntTarget of hunts) {
      const targetLower = String(huntTarget).toLowerCase();
      if (candidateTerms.some(term => term.includes(targetLower) || targetLower.includes(term))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Selects the best prey target from perceived entities.
   */
  static selectTarget(creature, memory, profile, now) {
    // Cooldown check for switching targets
    if (memory.isOnCooldown('targetSwitch', now)) {
      // Keep existing target if still valid AND still perceived
      if (memory.currentTargetEntity && this.isValidTarget(memory.currentTargetEntity, memory)) {
        // Is it still in perceived entities?
        const stillPerceived = memory.perceivedEntities.some(p => p.entity === memory.currentTargetEntity);
        if (stillPerceived) {
          return memory.currentTargetEntity;
        }
      }
    }

    let bestTarget = null;
    let closestDist = Infinity;

    for (const perceived of memory.perceivedEntities) {
      const candidateProfile = perceived.entity.profile;
      
      if (this.isValidPrey(profile, candidateProfile)) {
        if (perceived.distance < closestDist) {
          closestDist = perceived.distance;
          bestTarget = perceived.entity;
        }
      }
    }

    return bestTarget;
  }

  static isValidTarget(entity, memory) {
    // If the entity was removed or destroyed, it's invalid
    if (!entity || !entity.model) return false;
    
    // If it's too far (not in perceived entities) it might still be valid for a short time
    // but we'll let CreatureMemory handle the timeout.
    return true;
  }
}
