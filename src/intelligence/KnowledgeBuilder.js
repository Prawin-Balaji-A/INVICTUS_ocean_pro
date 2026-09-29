/**
 * KnowledgeBuilder.js
 * The orchestration layer for ecosystem intelligence.
 * Standardized generic object IntelligenceProfile pipeline.
 * Hierarchy: Cache -> Gemini Backend -> WoRMS (local) -> Fallback (local)
 */

import { KnowledgeCache } from './KnowledgeCache.js';
import { GeminiAgent } from './GeminiAgent.js';
import { resolveSpecies, normalizeName } from '../SpeciesResolver.js';
import { createFallbackProfile } from '../SpeciesProfile.js';
import localMarineKnowledge from '../data/marineKnowledge.json' with { type: 'json' };

export class KnowledgeBuilder {
  // Assets for which a background thin→rich enrichment has already been attempted
  // this session — prevents repeat live calls when serving a thin cached profile.
  static _upgradeAttempted = new Set();

  /**
   * Normalizes a profile into the standardized Generic Object Intelligence Profile.
   */
  static normalizeProfile(data, sourceTag = 'unknown') {
    const rawId = data.identity || {};
    const rawTax = data.taxonomy || data.classification || {};
    const rawEco = data.ecology || {};
    const rawBehav = data.behaviorModel || data.behavior || {};
    const rawEcosys = data.ecosystem || {};

    const commonName = rawId.displayName || rawId.commonName || normalizeName(rawId.assetName || data.assetName || 'Marine Organism');
    const isAmbiguous = rawId.ambiguous === true || !rawId.scientificName;
    const scientificName = isAmbiguous ? null : rawId.scientificName;
    const aphiaId = rawId.aphiaId || null;
    const confidence = rawId.confidence !== undefined ? 
      (typeof rawId.confidence === 'number' ? (rawId.confidence > 0.7 ? 'HIGH' : rawId.confidence > 0.4 ? 'MEDIUM' : 'LOW') : rawId.confidence) 
      : (sourceTag === 'gemini+research' ? 'HIGH' : sourceTag === 'worms' ? 'HIGH' : 'LOW');

    // Classification - strictly verified, else null
    const classification = {
      kingdom: rawTax.kingdom || null,
      phylum: rawTax.phylum || null,
      class: rawTax.className || rawTax.class || null,
      order: rawTax.order || null,
      family: rawTax.family || null,
      genus: rawTax.genus || null
    };

    // Ecology - strictly verified, else null (never hallucinated)
    const ecology = {
      habitat: rawEco.habitat || null,
      depth: rawEco.depthRange || rawEco.depth || null,
      distribution: rawEco.distribution || null,
      diet: rawEco.diet || null
    };

    // Behavior - strictly verified, else null. Tolerant of either nesting
    // (the backend now nests socialBehavior/activityPattern/verticalMovement
    // under behaviorModel, but older shapes put social/activity under ecology).
    const behavior = {
      movement: rawBehav.movementType || rawBehav.locomotion || null,
      schooling: rawBehav.schooling !== undefined && rawBehav.schooling !== null ? rawBehav.schooling : null,
      social: rawBehav.socialBehavior || rawEco.socialBehavior || null,
      activity: rawBehav.activityPattern || rawEco.activityPattern || null,
      verticalMovement: rawBehav.verticalMovement || null
    };

    // Ecosystem - strictly verified, else null
    const ecosystem = {
      predators: rawBehav.predator || rawEcosys.predators || null,
      prey: rawBehav.prey || rawEcosys.prey || null
    };

    // Morphology, Conservation, Reproduction & Facts
    const morphology = {
      size: data.morphology?.size || data.size || rawEco.size || null,
      lengthMeters: (typeof data.morphology?.lengthMeters === 'number' ? data.morphology.lengthMeters : null)
    };
    const conservationStatus = data.conservationStatus || rawEco.conservationStatus || null;
    const reproduction = data.reproduction || null;
    let interestingFact = data.interestingFact || data.fact || data.reasoning?.summary || null;

    // Sanitize any debugging or raw filename text from interestingFact — never fabricate a replacement
    if (interestingFact && (interestingFact.includes('asset filename') || interestingFact.includes('.glb') || interestingFact.includes('ambiguous at the species level'))) {
      interestingFact = null;
    }

    // Sources
    let sources = data.sources || [];
    if (sources.length === 0) {
      if (sourceTag === 'gemini+research') sources = ['World Register of Marine Species (WoRMS)'];
      else if (sourceTag === 'worms') sources = ['World Register of Marine Species (WoRMS)'];
      else sources = ['Ocean Biological Intelligence'];
    }

    // Determine unknown/null fields
    const unknowns = [];
    if (!scientificName) unknowns.push('scientificName');
    if (!classification.class && !classification.family) unknowns.push('classification');
    if (!ecology.habitat) unknowns.push('habitat');
    if (!ecology.depth) unknowns.push('depth');
    if (!ecology.diet) unknowns.push('diet');
    if (!behavior.movement && behavior.schooling === null) unknowns.push('behavior');

    return {
      identity: {
        commonName,
        scientificName,
        taxon: classification.class || classification.family || classification.order || (isAmbiguous ? 'Species identification uncertain' : 'Marine Organism'),
        aphiaId,
        confidence,
        ambiguous: isAmbiguous
      },
      classification,
      ecology,
      behavior,
      ecosystem,
      morphology,
      conservationStatus,
      reproduction,
      interestingFact,
      sources,
      unknowns,
      _meta: { source: sourceTag, isLoaded: true, isAmbiguous }
    };
  }

  /**
   * A profile is genuinely RESOLVED only when it came from live research (Gemini
   * tool-calling) or the authoritative WoRMS resolver. The conservative
   * 'unresolved' fallback is NOT resolved — it must never be cached permanently,
   * or it short-circuits all future research and the cache degrades into a static
   * species list. This single gate governs BOTH "serve from cache" and "save to
   * cache", so unknown/new assets always have a clear path to fresh research.
   */
  static _isResolved(profile) {
    const src = profile && profile._meta && profile._meta.source;
    return src === 'local' || src === 'gemini+research' || src === 'worms';
  }

  /**
   * Fast synchronous lookup in the master local knowledge base.
   */
  static findLocalProfile(identifier) {
    if (!identifier || typeof identifier !== 'string') return null;
    const clean = identifier.trim().toLowerCase();
    let found = localKnowledgeMap.get(clean);
    if (!found) {
      const noExt = clean.replace(/\.glb$/i, '');
      found = localKnowledgeMap.get(noExt) ||
              localKnowledgeMap.get(noExt.replace(/[_\s-]+/g, ' ')) ||
              localKnowledgeMap.get(noExt.replace(/[_\s-]+/g, '_'));
    }
    return found || null;
  }

  /**
   * A resolved profile is RICH when it carries genuine biology beyond bare
   * taxonomy (habitat/depth/distribution/diet, movement/social/activity/vertical,
   * or a size). A taxonomy-only resolve (e.g. only class="Mammalia") is NOT rich —
   * that is precisely the degraded "Mammalia only" card the correction pass targets.
   */
  static _isRich(profile) {
    if (!profile) return false;
    const eco = profile.ecology || {};
    const behav = profile.behavior || {};
    const morph = profile.morphology || {};
    const ecoFacts = [eco.habitat, eco.depth, eco.distribution, eco.diet].filter(Boolean).length;
    const behavFacts = [behav.movement, behav.social, behav.activity, behav.verticalMovement].filter(Boolean).length;
    const hasSize = !!(morph.size || morph.lengthMeters);
    return (ecoFacts + behavFacts + (hasSize ? 1 : 0)) >= 2;
  }

  /**
   * True when a resolved profile carries authoritative taxonomy — a scientific name
   * plus at least one of class/family/genus. A direct WoRMS resolve is taxonomy-only
   * but still REAL, verified biology (family/genus/class), so it must be persisted
   * and shown (Family especially); absent ecology fields render as "Not available",
   * never fabricated.
   */
  static _hasVerifiedTaxonomy(profile) {
    const t = (profile && profile.classification) || {};
    return !!(t.class || t.family || t.genus) && !!(profile && profile.identity && profile.identity.scientificName);
  }

  /**
   * Whether a profile may be SAVED to / SERVED from cache. Never the unresolved
   * fallback (see _isResolved). Ambiguous profiles are intentionally stable. A
   * non-ambiguous resolve is cacheable when it is RICH or carries verified taxonomy.
   */
  static _isCacheable(profile) {
    if (!this._isResolved(profile)) return false;
    if (profile._meta?.isAmbiguous) return true;
    return this._isRich(profile) || this._hasVerifiedTaxonomy(profile);
  }

  /**
   * Main entrypoint for resolving any creature or object's biological profile.
   * Runtime guarantee: 100% offline, 0 network requests, 0 Gemini calls, 0 latency.
   * All creature knowledge is served directly from local master knowledge base.
   */
  static async buildProfile(assetName) {
    if (!assetName) return null;

    // 1. Performance cache check
    const cached = KnowledgeCache.get(assetName);
    if (cached && cached._meta?.isLoaded && this._isCacheable(cached)) {
      return cached;
    }

    // 2. Master Local Knowledge Base (Instant, 0 network, 0 latency, 100% offline)
    const local = this.findLocalProfile(assetName);
    if (local) {
      KnowledgeCache.save(assetName, local);
      return local;
    }

    // 3. Fallback for uncatalogued entity: conservative, un-hallucinated fallback (NO runtime Gemini/WoRMS calls)
    console.warn(`[Intelligence] Uncatalogued entity: ${assetName} — using conservative local fallback`);
    const fallback = {
      identity: {
        commonName: normalizeName(assetName),
        scientificName: null,
        taxon: 'Species Not Resolved',
        confidence: 'LOW',
        ambiguous: true
      },
      classification: { kingdom: null, phylum: null, class: null, order: null, family: null, genus: null },
      ecology: { habitat: null, depth: null, distribution: null, diet: null },
      behavior: { movement: null, schooling: null, activity: null },
      ecosystem: { predators: null, prey: null },
      sources: ['Local Marine Knowledge Registry'],
      unknowns: ['scientificName', 'classification', 'habitat', 'depth', 'diet', 'behavior'],
      _meta: { source: 'unresolved', isLoaded: true, isAmbiguous: true }
    };
    return fallback;
  }

  /**
   * Administrative flow for researching a brand new creature and persisting to local knowledge.
   * NEVER called during gameplay, creature approach, or codex opening.
   */
  static async researchAndPersistAdmin(assetName) {
    if (!assetName) return null;
    console.log(`[Admin] Researching creature via Gemini: ${assetName}`);
    let geminiResult = null;
    try {
      geminiResult = await GeminiAgent.researchSpecies(assetName);
    } catch (e) {
      console.warn(`[Admin] Gemini call failed for ${assetName}:`, e?.message || e);
    }

    let normalized = null;
    if (geminiResult && !geminiResult.error) {
      normalized = this.normalizeProfile(geminiResult, 'gemini+research');
    } else {
      const legacyProfile = await resolveSpecies(assetName);
      if (legacyProfile && legacyProfile.source?.provider === 'WoRMS') {
        normalized = this.normalizeProfile(legacyProfile, 'worms');
      }
    }

    if (normalized) {
      if (!normalized.aliases) normalized.aliases = [];
      if (!normalized.aliases.includes(assetName)) normalized.aliases.push(assetName);
      // Index into local memory
      _indexKnowledgeRecords([normalized]);
      KnowledgeCache.save(assetName, normalized);

      // Persist to backend server POST /api/knowledge
      try {
        const url = typeof window !== 'undefined' && window.location.port !== '3000'
          ? `/api/knowledge`
          : `http://127.0.0.1:3000/api/knowledge`;
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalized)
        });
      } catch (err) {
        console.warn('[Admin] Failed to persist to backend:', err.message || err);
      }
    }
    return normalized;
  }


  /**
   * Creates an immediate non-hallucinated placeholder while research is running in background.
   */
  static createImmediateFallback(assetName) {
    const displayName = normalizeName(assetName);
    return {
      identity: {
        commonName: displayName,
        displayName: displayName,
        assetName: assetName,
        scientificName: null,
        taxon: 'Resolving Species...',
        confidence: 'PENDING',
        ambiguous: false
      },
      classification: {},
      ecology: {},
      behavior: {},
      ecosystem: {},
      sources: [],
      unknowns: ['scientificName', 'classification', 'habitat', 'depth', 'diet', 'behavior'],
      _meta: { isIdentifying: true, isLoaded: false }
    };
  }

  static createObjectProfile(entity) {
    const cat = (entity.category || entity.entityType || '').toLowerCase();

    if (cat === 'argo') {
      return {
        identity: {
          commonName: entity.name || 'Argo CTD Profiling Float',
          scientificName: 'Autonomous Oceanographic Profiler',
          taxon: 'Oceanographic Technology',
          modelId: entity.id,
          confidence: 'HIGH',
          icon: '📡',
          category: 'instrument'
        },
        telemetry: {
          status: entity.status || 'Profiling Cycle',
          depth: typeof entity.depth === 'number' ? `${Math.abs(entity.depth).toFixed(1)} m` : 'Variable (0 – 2,000m)',
          temperature: typeof entity.temperature === 'number' ? `${entity.temperature.toFixed(1)} °C` : '24.5 °C',
          salinity: typeof entity.salinity === 'number' ? `${entity.salinity.toFixed(2)} PSU` : '34.80 PSU',
          mission: 'Autonomous thermocline & salinity profiling'
        },
        ecology: {},
        interestingFact: 'Argo floats autonomously drift with deep ocean currents at 1,000m, diving to 2,000m before ascending to beam CTD profiles to satellites.',
        sources: [entity.dataSource || 'International Argo Program (argo.ucsd.edu)'],
        unknowns: [],
        _meta: { isInstrument: true, isLoaded: true }
      };
    }

    if (cat === 'glider') {
      return {
        identity: {
          commonName: entity.name || 'Autonomous Ocean Glider',
          scientificName: 'Sawtooth Hydrographic Glider',
          taxon: 'Autonomous Underwater Vehicle',
          modelId: entity.id,
          confidence: 'HIGH',
          icon: '🧭',
          category: 'instrument'
        },
        telemetry: {
          status: entity.status || 'Active Sawtooth Mission',
          depth: typeof entity.depth === 'number' ? `${Math.abs(entity.depth).toFixed(1)} m` : 'Sawtooth (-8m to -115m)',
          temperature: typeof entity.temperature === 'number' ? `${entity.temperature.toFixed(1)} °C` : '22.0 °C',
          mission: 'High-resolution hydrographic transects'
        },
        ecology: {},
        interestingFact: 'Underwater gliders change buoyancy by pumping mineral oil between internal bladders, gliding silently without propellers for thousands of kilometers.',
        sources: [entity.dataSource || 'Ocean Glider Fleet Telemetry (NOAA IOOS)'],
        unknowns: [],
        _meta: { isInstrument: true, isLoaded: true }
      };
    }

    if (cat === 'buoy') {
      return {
        identity: {
          commonName: entity.name || 'Moored Met-Ocean Buoy',
          scientificName: 'Surface Meteorological Station',
          taxon: 'Surface Meteorological Buoy',
          modelId: entity.id,
          confidence: 'HIGH',
          icon: '⚓',
          category: 'instrument'
        },
        telemetry: {
          status: entity.status || 'Operational (Surface Transmitting)',
          depth: 'Surface (0.0 m)',
          sst: typeof entity.sst === 'number' ? `${entity.sst.toFixed(1)} °C` : '28.6 °C',
          windSpeed: typeof entity.windSpeed === 'number' ? `${entity.windSpeed.toFixed(1)} kts` : '12.4 kts',
          mission: 'Continuous air-sea flux & ocean state monitoring'
        },
        ecology: {},
        interestingFact: 'Moored buoys measure sea surface temperature, wave vectors, and barometric pressure, broadcasting real-time early warnings for cyclones and tsunamis.',
        sources: [entity.dataSource || 'INCOIS / NOAA Moored Buoy Network (NDBC)'],
        unknowns: [],
        _meta: { isInstrument: true, isLoaded: true }
      };
    }

    if (cat === 'rov') {
      return {
        identity: {
          commonName: entity.name || 'Deep-Sea Research ROV',
          scientificName: 'Deep Submergence Robotic Vehicle',
          taxon: 'Benthic Submersible',
          modelId: entity.id,
          confidence: 'HIGH',
          icon: '🤖',
          category: 'instrument'
        },
        telemetry: {
          status: entity.status || 'Benthic Survey Active',
          depth: typeof entity.depth === 'number' ? `${Math.abs(entity.depth).toFixed(1)} m` : 'Seabed (142 m)',
          mission: 'Deep seabed visual inspection and high-definition bathymetric sampling'
        },
        ecology: {},
        interestingFact: 'Deep ROVs explore crushing ocean depths exceeding 6,000 meters, equipped with robotic arms, 4K cameras, and laser scaling beams.',
        sources: [entity.dataSource || 'Deep Ocean Exploration Fleet'],
        unknowns: [],
        _meta: { isInstrument: true, isLoaded: true }
      };
    }

    if (cat === 'vessel' || cat === 'ship') {
      // Surface vessel (the container ship). This is a SIMULATION / visualisation
      // entity, NOT an ocean observation and NOT a biological species — so it is
      // resolved HERE and short-circuits the WoRMS/Gemini species pipeline entirely
      // (it never reaches buildProfile, so it can never sit on "Resolving species…").
      // Only genuinely-known facts are asserted: name, that it is a container ship,
      // that it is a vessel, and its status. IMO number, owner, operator, flag/country,
      // capacity and route are NOT known for this model and are deliberately omitted —
      // never invented. The interestingFact is a generic, verifiable statement about
      // container ships as a class (mirroring the instrument facts above), not a claim
      // about this specific vessel.
      return {
        identity: {
          commonName: entity.name || 'InVictus',
          scientificName: null,
          taxon: 'Container Ship',
          modelId: entity.id || 'CONTAINER-VESSEL-01',
          confidence: 'HIGH',
          icon: '🚢',
          category: 'vessel'
        },
        vessel: {
          type: 'Container Ship',
          category: 'Commercial maritime surface vessel',
          status: entity.status || 'Active · Simulation entity'
        },
        ecology: {},
        interestingFact: 'Container ships carry cargo in standardised intermodal containers that transfer directly between ship, rail and truck — a system that reshaped global trade by drastically cutting the time and cost of loading and unloading.',
        sources: [entity.dataSource || 'Simulation / visualisation (not an ocean observation)'],
        unknowns: [],
        _meta: { isVessel: true, isLoaded: true }
      };
    }

    if (cat === 'shipwreck' || entity.entityType === 'shipwreck') {
      return {
        identity: {
          commonName: entity.name || '17th-Century Sunken Galleon',
          scientificName: 'Historic Artificial Benthic Reef',
          taxon: 'Historic Artificial Reef',
          modelId: entity.id || 'SHIPWRECK-SAN-PEDRO',
          confidence: 'HIGH',
          icon: '🚢',
          category: 'benthic'
        },
        ecology: {
          habitat: 'Benthic Sandy Seafloor Abyss',
          depth: '150.0 m (Seabed Floor)',
          role: 'Submerged artificial reef & biodiversity sanctuary',
          size: '138 m length × 50 m height'
        },
        interestingFact: 'Centuries-old shipwrecks form vital artificial reefs on barren abyssal plains, providing substrate for deep-sea corals, sponges, and refuge for megafauna.',
        sources: [entity.dataSource || 'Bathymetric Survey Registry (UNESCO Underwater Heritage)'],
        unknowns: [],
        _meta: { isBenthic: true, isLoaded: true }
      };
    }

    return null;
  }

  /**
   * Resolves the depth envelope for a creature.
   * Strictly distinguishes between verified biological envelope (from authoritative sources)
   * and simulation safety envelope (used ONLY for safe steering / movement, marked isFallback: true).
   * Fallback values are NEVER displayed in the UI as verified biological information.
   */
  static resolveDepthEnvelope(profile, categoryHint = null) {
    const eco = (profile && profile.ecology) || {};
    const depthVal = eco.depthRange || eco.depth;
    const isVerifiedSource = profile && profile._meta && (profile._meta.source === 'gemini+research' || profile._meta.source === 'worms' || profile._meta.source === 'local');

    // Attempt to extract verified min/max from profile
    let verifiedMin = null;
    let verifiedMax = null;

    // Check if profile.depthRange explicitly marks verification
    const dRange = profile && profile.depthRange;
    if (dRange && dRange.verified === true && typeof dRange.minMeters === 'number' && typeof dRange.maxMeters === 'number') {
      verifiedMin = Math.abs(dRange.minMeters);
      verifiedMax = Math.abs(dRange.maxMeters);
    } else if (depthVal && isVerifiedSource && (!dRange || dRange.verified !== false)) {
      if (typeof depthVal === 'object' && depthVal !== null) {
        const min = depthVal.min ?? depthVal.minDepth;
        const max = depthVal.max ?? depthVal.maxDepth;
        if (typeof min === 'number' && typeof max === 'number' && min <= max) {
          verifiedMin = min;
          verifiedMax = max;
        }
      } else if (typeof depthVal === 'string') {
        // e.g. "2 - 30 m", "10-50m", "0 - 200 meters"
        const match = depthVal.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/i);
        if (match) {
          const v1 = parseFloat(match[1]);
          const v2 = parseFloat(match[2]);
          if (!isNaN(v1) && !isNaN(v2)) {
            verifiedMin = Math.min(v1, v2);
            verifiedMax = Math.max(v1, v2);
          }
        }
      }
    }

    if (verifiedMin !== null && verifiedMax !== null) {
      // Verified biological envelope: meters depth (positive down) mapped to simulation Y (-meters)
      const minDepth = -Math.abs(verifiedMin); // shallowest (closest to 0)
      const maxDepth = -Math.abs(verifiedMax); // deepest (furthest below 0)
      const preferredDepth = (minDepth + maxDepth) / 2;
      return {
        minDepth,
        maxDepth,
        preferredDepth,
        source: 'verified',
        isFallback: false
      };
    }

    // If profile defines simulationDepthEnvelope, use it for safe steering
    if (profile && profile.simulationDepthEnvelope && typeof profile.simulationDepthEnvelope.minMeters === 'number' && typeof profile.simulationDepthEnvelope.maxMeters === 'number') {
      const s = profile.simulationDepthEnvelope;
      const minD = s.minMeters;
      const maxD = s.maxMeters;
      const prefD = typeof s.preferredDepth === 'number' ? s.preferredDepth : (minD + maxD) / 2;
      return {
        minDepth: minD,
        maxDepth: maxD,
        preferredDepth: prefD,
        source: 'simulation-fallback',
        isFallback: true
      };
    }

    // Simulation Safety Envelope (Fallback for movement only, NOT biological data)
    // Distributed according to natural biological habitat archetype
    const cat = String(categoryHint || profile?.identity?.category || '').toLowerCase();
    const cls = String(profile?.classification?.class || '').toLowerCase();
    const order = String(profile?.classification?.order || '').toLowerCase();

    // Natural habitat categorization:
    let minD = -3.0;
    let maxD = -35.0;
    let prefD = -15.0;

    if (cat === 'stingray' || cat === 'ray' || cat === 'octopus' || order.includes('myliobatiformes') || cls.includes('cephalopoda')) {
      // Demersal / benthic habitat
      minD = -115.0;
      maxD = -145.0;
      prefD = -135.0;
    } else if (cat === 'whale' || cls.includes('mammalia') || order.includes('cetacea')) {
      // Cetaceans: open pelagic roamers
      minD = -6.0;
      maxD = -95.0;
      prefD = -40.0;
    } else if (cat === 'shark' || cat === 'hammerhead' || cls.includes('chondrichthyes') || cls.includes('elasmobranch')) {
      // Pelagic patrol / apex predators
      minD = -8.0;
      maxD = -75.0;
      prefD = -35.0;
    } else if (cat === 'dolphin' || cat === 'orca' || cat === 'sea_turtle' || order.includes('testudines')) {
      // Epipelagic / surface-breaching animals
      minD = -2.5;
      maxD = -28.0;
      prefD = -8.0;
    } else if (cat === 'jellyfish' || cls.includes('scyphozoa') || profile?.classification?.phylum === 'Cnidaria') {
      // Drifting cnidarians in mid-water
      minD = -8.0;
      maxD = -50.0;
      prefD = -22.0;
    } else if (cat === 'large_fish' || cat === 'manta') {
      // Mid-water pelagic swimmers
      minD = -15.0;
      maxD = -65.0;
      prefD = -32.0;
    } else {
      // Shallow reef fish (small fish, clownfish, angelfish, tang, etc.)
      minD = -2.5;
      maxD = -32.0;
      prefD = -12.0;
    }

    return {
      minDepth: minD,
      maxDepth: maxD,
      preferredDepth: prefD,
      source: 'simulation-fallback',
      isFallback: true
    };
  }
}

const localKnowledgeMap = new Map();

function _indexKnowledgeRecords(list) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item) continue;
    const normalized = KnowledgeBuilder.normalizeProfile(item, item._meta?.source || 'local');
    if (item.depthRange) normalized.depthRange = item.depthRange;
    if (item.simulationDepthEnvelope) normalized.simulationDepthEnvelope = item.simulationDepthEnvelope;
    if (item.category) normalized.category = item.category;
    if (item.aliases) normalized.aliases = item.aliases;
    if (item.status) normalized.status = item.status;
    if (item.fact && !normalized.interestingFact) normalized.interestingFact = item.fact;

    const registerKey = (k) => {
      if (!k || typeof k !== 'string') return;
      const clean = k.trim().toLowerCase();
      localKnowledgeMap.set(clean, normalized);
      const noExt = clean.replace(/\.glb$/i, '');
      localKnowledgeMap.set(noExt, normalized);
      localKnowledgeMap.set(noExt.replace(/[_\s-]+/g, ' '), normalized);
      localKnowledgeMap.set(noExt.replace(/[_\s-]+/g, '_'), normalized);
    };

    if (item.id) registerKey(item.id);
    if (item.commonName) registerKey(item.commonName);
    if (item.scientificName) registerKey(item.scientificName);
    if (item.identity) {
      if (item.identity.commonName) registerKey(item.identity.commonName);
      if (item.identity.displayName) registerKey(item.identity.displayName);
      if (item.identity.scientificName) registerKey(item.identity.scientificName);
    }
    if (Array.isArray(item.aliases)) {
      for (const a of item.aliases) registerKey(a);
    }
  }
}

// Index the master local knowledge base immediately
_indexKnowledgeRecords(localMarineKnowledge);
