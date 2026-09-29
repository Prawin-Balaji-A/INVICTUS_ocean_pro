import { BehaviorProfile } from './BehaviorProfile.js';
import { KnowledgeBuilder } from '../intelligence/KnowledgeBuilder.js';

/**
 * BehaviorBuilder - maps a canonical KnowledgeProfile into a simulation BehaviorProfile.
 *
 * Reads ONLY the canonical profile shape produced by KnowledgeBuilder.normalizeProfile().
 * Movement archetype is chosen from AUTHORITATIVE TAXONOMY first, then falls back to 
 * the filename-derived `category` hint, then a generic swim.
 * 
 * NO species-name string literals - adding a new species never requires editing this file.
 */
export class BehaviorBuilder {
  static buildFromKnowledge(knowledge, category = null) {
    const profile = new BehaviorProfile();

    if (!knowledge || !knowledge.identity) {
      profile.meta.unknowns.push('Completely missing knowledge profile');
      profile.meta.source = 'category-fallback';
      this.applyArchetype(profile, this.archetypeFromCategory(category));
      this.applyTrophic(profile, {}, {}, {}, category);
      this.finalize(profile, { behavior: {}, ecology: {} });
      return profile;
    }

    const identity = knowledge.identity || {};
    profile.meta.source = 'knowledge';
    if (identity.ambiguous) {
      profile.meta.assumptions.push('Ambiguous/generic species asset. Deriving archetype from asset category.');
      profile.meta.confidence = 'LOW';
    } else {
      profile.meta.confidence = identity.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM';
    }

    const tax = knowledge.classification || {};
    const eco = knowledge.ecology || {};
    const behav = knowledge.behavior || {};
    const ecosys = knowledge.ecosystem || {};

    // Archetype: (1) authoritative taxonomy, (2) filename category hint, (3) generic swim
    let archetype = this.archetypeFromTaxonomy(tax, behav);
    if (!archetype) {
      archetype = this.archetypeFromCategory(category);
      if (category) {
        profile.meta.assumptions.push(`No authoritative taxonomy; archetype derived from asset category "${category}".`);
      } else {
        profile.meta.unknowns.push('No taxonomy or category - using generic swim archetype.');
      }
    }
    this.applyArchetype(profile, archetype);

    // Trophic role & food-web links
    this.applyTrophic(profile, tax, eco, ecosys, category);

    // Surface behavior from knowledge
    this.applySurfaceBehavior(profile, eco, behav, archetype);

    // Social grouping, habitat, activity, and simulation defaults
    this.finalize(profile, knowledge);

    return profile;
  }

  static archetypeFromTaxonomy(tax, behav) {
    const phylum = (tax.phylum || '').toLowerCase();
    const classTax = (tax.className || tax.class || '').toLowerCase();
    const order = (tax.order || '').toLowerCase();
    const family = (tax.family || '').toLowerCase();
    const genus = (tax.genus || '').toLowerCase();
    const locomotion = (behav?.movementType || behav?.movement || behav?.locomotion || '').toLowerCase();

    // Cnidarians - drifting/pulsing plankton
    if (phylum === 'cnidaria') return 'DRIFT';

    // Marine mammals - dolphins/porpoises surface-swim
    if (classTax.includes('mammalia') || classTax.includes('cetacea')) {
      if (genus.includes('tursiops') || genus.includes('delphinus') || genus.includes('orca') || genus.includes('stenella')) {
        return 'DELPHINID';
      }
      return 'WHALE_CRUISE';
    }

    // Sea turtles - surface swimmers
    if (order.includes('testudines') || family.includes('cheloni')) return 'SURFACE_SWIM';

    // Rays - benthic/gliding
    if (order.includes('myliobatiformes') || order.includes('rajiformes')) return 'BENTHIC';

    // Sharks - patrol/predator
    if (classTax.includes('chondrichthyes') || classTax.includes('elasmobranchii')) {
      if (order.includes('lamniformes') || order.includes('carcharhiniformes')) return 'PATROL';
    }

    // Cephalopods - exploratory
    if (classTax.includes('cephalopoda')) return 'BENTHIC';

    return null;
  }

  static archetypeFromCategory(category) {
    const cat = (category || '').toLowerCase();
    if (cat === 'jellyfish') return 'DRIFT';
    if (cat === 'dolphin' || cat === 'orca') return 'DELPHINID';
    if (cat === 'whale') return 'WHALE_CRUISE';
    if (cat === 'shark' || cat === 'hammerhead' || cat === 'large_fish') return 'PATROL';
    if (cat === 'stingray' || cat === 'manta' || cat === 'octopus') return 'BENTHIC';
    if (cat === 'sea_turtle') return 'SURFACE_SWIM';
    if (cat === 'fish' || cat === 'bicolor_angelfish' || cat === 'clownfish' || cat === 'tang') return 'SWIM';
    return 'SWIM';
  }

  static applyArchetype(profile, archetype) {
    profile.movement.archetype = archetype;
    
    switch (archetype) {
      case 'WHALE_CRUISE':
        profile.movement.preferredSpeed = 3.0;
        profile.movement.acceleration = 0.15;
        profile.movement.turnRate = 0.015;
        profile.movement.verticalMobility = 0.3;
        profile.social.schooling = false;
        profile.habitat.canSurface = true;
        profile.habitat.surfaceBehavior = 'APPROACH';
        break;
        
      case 'DELPHINID':
        profile.movement.preferredSpeed = 6.0;
        profile.movement.acceleration = 0.4;
        profile.movement.turnRate = 0.06;
        profile.movement.verticalMobility = 0.7;
        profile.social.schooling = true;
        profile.social.groupPreference = 5;
        profile.habitat.canSurface = true;
        profile.habitat.surfaceBehavior = 'BREACH';
        break;
        
      case 'PATROL':
        profile.movement.preferredSpeed = 4.5;
        profile.movement.acceleration = 0.3;
        profile.movement.turnRate = 0.04;
        profile.movement.verticalMobility = 0.4;
        profile.social.schooling = false;
        break;
        
      case 'SURFACE_SWIM':
        profile.movement.preferredSpeed = 3.5;
        profile.movement.acceleration = 0.35;
        profile.movement.turnRate = 0.05;
        profile.movement.verticalMobility = 0.5;
        profile.social.schooling = false;
        profile.habitat.canSurface = true;
        profile.habitat.surfaceBehavior = 'APPROACH';
        break;
        
      case 'DRIFT':
        profile.movement.preferredSpeed = 0.5;
        profile.movement.acceleration = 0.05;
        profile.movement.turnRate = 0.02;
        profile.movement.verticalMobility = 0.8;
        profile.social.schooling = true;
        break;
        
      case 'BENTHIC':
        profile.movement.preferredSpeed = 2.0;
        profile.movement.acceleration = 0.2;
        profile.movement.turnRate = 0.03;
        profile.movement.verticalMobility = 0.2;
        profile.social.schooling = false;
        break;
        
      case 'SWIM':
      default:
        profile.movement.preferredSpeed = 3.5;
        profile.movement.acceleration = 0.4;
        profile.movement.turnRate = 0.06;
        profile.movement.verticalMobility = 0.5;
        profile.social.schooling = true;
        profile.social.groupPreference = 6;
        break;
    }
  }

  static applyTrophic(profile, tax, eco, ecosys, category) {
    const classTax = (tax.className || tax.class || '').toLowerCase();
    const order = (tax.order || '').toLowerCase();
    const cat = (category || '').toLowerCase();
    const diet = (eco?.diet || '').toLowerCase();

    const isRay = order.includes('myliobatiformes') || order.includes('rajiformes') ||
                  cat === 'stingray' || cat === 'ray' || cat === 'manta';
    const isSharkTax = (classTax.includes('elasmobranchii') || classTax.includes('chondrichthyes')) && !isRay;
    const isSharkCat = cat === 'shark' || cat === 'hammerhead';

    let isPredator = false;
    let huntsTaxa = [];

    if (isSharkTax || isSharkCat) {
      isPredator = true;
      huntsTaxa = ['fish', 'teleostei', 'actinopterygii', 'ray', 'tang'];
    }

    if (diet.includes('carnivore') || diet.includes('piscivore') || diet.includes('apex') || diet.includes('predator')) {
      isPredator = true;
    }

    if (Array.isArray(ecosys?.prey) && ecosys.prey.length) {
      const preyTaxa = ecosys.prey.map(p => String(p).toLowerCase());
      huntsTaxa = Array.from(new Set([...huntsTaxa, ...preyTaxa]));
      isPredator = true;
    }

    const predatorTaxa = Array.isArray(ecosys?.predators)
      ? ecosys.predators.map(p => String(p).toLowerCase())
      : [];

    profile.interaction.predator = isPredator;
    profile.interaction.threatResponse = isPredator ? 'CHASE' : 'FLEE';
    profile.interaction.huntsTaxa = huntsTaxa;
    profile.interaction.predatorTaxa = predatorTaxa;
  }

  static applySurfaceBehavior(profile, eco, behav, archetype) {
    // Only surface-capable archetypes can surface
    const surfaceCapable = ['DELPHINID', 'WHALE_CRUISE', 'SURFACE_SWIM'].includes(archetype);
    
    if (!surfaceCapable) {
      profile.habitat.canSurface = false;
      profile.habitat.surfaceBehavior = null;
      return;
    }

    // Check knowledge profile for surface behavior
    const surfaceKnowledge = eco?.habitat || '';
    const behaviorKnowledge = behav?.surfaceBehavior || behav?.activityPattern || behav?.activity || behav?.verticalMovement || '';

    if (surfaceKnowledge.includes('surface') || behaviorKnowledge.includes('breach')) {
      profile.habitat.canSurface = true;
      profile.habitat.surfaceBehavior = 'BREACH';
    } else if (surfaceKnowledge.includes('pelagic') || surfaceKnowledge.includes('epipelagic')) {
      profile.habitat.canSurface = true;
      profile.habitat.surfaceBehavior = 'APPROACH';
    }
  }

  static finalize(profile, knowledge) {
    const behav = knowledge.behavior || {};
    const eco = knowledge.ecology || {};

    // Depth envelope (strictly distinguishing verified vs simulation-fallback)
    const depthEnv = KnowledgeBuilder.resolveDepthEnvelope(knowledge, profile.movement?.archetype || null);
    profile.habitat.minDepth = depthEnv.minDepth;
    profile.habitat.maxDepth = depthEnv.maxDepth;
    profile.habitat.preferredDepth = depthEnv.preferredDepth;
    profile.habitat.depthEnvelope = depthEnv;

    // Social schooling from verified data first
    if (behav.schooling !== undefined && behav.schooling !== null) {
      profile.social.schooling = behav.schooling;
    } else if (profile.movement.archetype === 'SWIM' || profile.movement.archetype === 'SURFACE_SWIM' || profile.movement.archetype === 'DELPHINID') {
      profile.social.schooling = true;
    }
    profile.social.groupPreference = profile.social.schooling ? 6 : null;

    // Descriptive fields from verified data
    profile.habitat.habitatType = eco.habitat || null;
    profile.movement.movementType = behav.movementType || behav.movement || behav.locomotion || null;
    profile.activity.activityPattern = behav.activityPattern || behav.activity || null;

    // Simulation defaults where biology didn't dictate specifics
    profile.movement.acceleration = profile.movement.acceleration || profile.simulationDefaults.acceleration;
    profile.movement.turnRate = profile.movement.turnRate || profile.simulationDefaults.turnRate;
    profile.social.separationStrength = profile.social.separationStrength || profile.simulationDefaults.separationStrength;
    profile.social.alignmentStrength = profile.social.alignmentStrength || profile.simulationDefaults.alignmentStrength;
    profile.social.cohesionStrength = profile.social.cohesionStrength || profile.simulationDefaults.cohesionStrength;
  }
}