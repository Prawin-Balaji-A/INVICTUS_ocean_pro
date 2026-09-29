import * as THREE from 'three';
import { KnowledgeBuilder } from '../intelligence/KnowledgeBuilder.js';
import { KnowledgeCache } from '../intelligence/KnowledgeCache.js';
import { DISCOVERED_ASSETS } from '../creatures/AssetManifest.js';

/**
 * OceanCodex — Generic Object Intelligence & Marine Education System.
 * 
 * Rules:
 * 1. Directional + proximity approach: focuses on entities in player's forward view (<24m, within view cone) or very close (<8m).
 * 2. Does NOT hijack the screen when creatures are behind or far off.
 * 3. Respects user dismissal: if closed by user, stays dismissed until re-approached.
 * 4. Caches all intelligence profiles; zero per-frame network overhead.
 */
export class OceanCodex {
  constructor(camera) {
    this.camera = camera;
    this.discoveries = new Map();
    this.interactionRadius = 24.0; // Max distance in meters
    this.onDiscoveryCallbacks = [];
    this.onFocusCallbacks = [];
    this.onBlurCallbacks = [];
    
    this.lastCheckTime = 0;
    this.focusedEntity = null;
    this.pendingResolutions = new Set();
    this.dismissedMap = new Map(); // entityKey -> timestamp until suppressed
    this._camDir = new THREE.Vector3();
    this._toEntity = new THREE.Vector3();
  }

  onDiscovery(callback) {
    this.onDiscoveryCallbacks.push(callback);
  }

  onTargetFocus(callback) {
    this.onFocusCallbacks.push(callback);
  }

  onTargetBlur(callback) {
    this.onBlurCallbacks.push(callback);
  }

  dismissTarget(entityKey) {
    if (!entityKey) return;
    this.dismissedMap.set(entityKey, performance.now() + 15000); // 15s cooldown
    if (this.focusedEntity && (this.focusedEntity.name === entityKey || this.focusedEntity.id === entityKey)) {
      this.focusedEntity = null;
      for (const cb of this.onBlurCallbacks) cb();
    }
  }

  /**
   * Evaluates proximity & forward sightline against all active entities.
   * Runs at ~8 Hz to ensure smooth 60 FPS performance.
   */
  update(time, allEntities) {
    if (!allEntities || allEntities.length === 0) return;
    
    // Throttle to ~8 Hz (every 125ms)
    if (time - this.lastCheckTime < 0.125) return;
    this.lastCheckTime = time;

    let closestEntity = null;
    let minDistance = Infinity;

    const camPos = this.camera.position;
    this.camera.getWorldDirection(this._camDir);
    const now = performance.now();

    for (const entity of allEntities) {
      if (!entity) continue;
      const pos = entity.model ? entity.model.position : entity.position;
      if (!pos) continue;

      const dist = camPos.distanceTo(pos);

      // Per-entity focus range: most entities use the default interaction radius, but a
      // large entity (the container ship) can declare a wider `focusRadius` so it is
      // discoverable from a realistic stand-off distance. Creatures without the field are
      // unaffected. "Closest in-sight wins" (minDistance) still arbitrates when several
      // entities are simultaneously in range.
      const r = entity.focusRadius || this.interactionRadius;

      // Check journal discovery unlock
      if (dist <= r + 8) {
        this._checkUnlock(entity);
      }

      // Check if entity is currently dismissed
      const key = entity.name || entity.id || '';
      if (this.dismissedMap.has(key)) {
        if (now < this.dismissedMap.get(key)) {
          continue;
        } else {
          this.dismissedMap.delete(key);
        }
      }

      // Directional check: must be in front of camera (angle < 65°, dot > 0.42) OR within near-field (< 8m)
      this._toEntity.subVectors(pos, camPos).normalize();
      const dot = this._camDir.dot(this._toEntity);
      const isInSight = dot > 0.42 || dist < 8.0;

      if (dist < r && isInSight && dist < minDistance) {
        minDistance = dist;
        closestEntity = entity;
      }
    }

    if (closestEntity) {
      if (this.focusedEntity !== closestEntity) {
        this.focusedEntity = closestEntity;
        this._handleEntityFocus(closestEntity, minDistance);
      } else {
        // Update distance / live telemetry if already focused
        this._emitFocus(closestEntity, minDistance);
      }
    } else {
      if (this.focusedEntity !== null) {
        this.focusedEntity = null;
        for (const cb of this.onBlurCallbacks) cb();
      }
    }
  }

  async _handleEntityFocus(entity, distance) {
    // 1. If it's an instrument / benthic feature, create object profile immediately
    const objProfile = KnowledgeBuilder.createObjectProfile(entity);
    if (objProfile) {
      entity.intelligenceProfile = objProfile;
      this._emitFocus(entity, distance);
      return;
    }

    const assetName = entity.name || 'creature.glb';

    // 2. Check if already attached and resolved
    const existing = entity.intelligenceProfile;
    if (existing && existing._meta?.isLoaded && existing._meta?.source !== 'unresolved') {
      this._emitFocus(entity, distance);
      return;
    }

    // 3. Local Master Knowledge Base hit (Instant, 0 network, offline)
    const local = KnowledgeCache.get(assetName) || KnowledgeBuilder.findLocalProfile(assetName);
    if (local) {
      entity.intelligenceProfile = local;
      KnowledgeCache.save(assetName, local);
      this._emitFocus(entity, distance);
      return;
    }

    // 4. Request profile via KnowledgeBuilder (instant local fallback if not found)
    const fullProfile = await KnowledgeBuilder.buildProfile(assetName);
    if (fullProfile) {
      entity.intelligenceProfile = fullProfile;
      if (this.focusedEntity === entity) {
        this._emitFocus(entity, distance);
      }
    }
  }

  _emitFocus(entity, distance) {
    const profile = entity.intelligenceProfile || KnowledgeBuilder.createImmediateFallback(entity.name || 'creature.glb');
    for (const cb of this.onFocusCallbacks) {
      cb(profile, entity, distance);
    }
  }

  _checkUnlock(entity) {
    const key = entity.name || entity.id || entity.intelligenceProfile?.identity?.commonName || 'Unknown';
    if (this.discoveries.has(key)) return;

    // Prefer an already-attached profile; else resolve a non-biological object profile
    // (instrument / vessel / wreck) so the journal entry is correct immediately. Only a
    // genuine creature (createObjectProfile → null) falls through to the "resolving"
    // placeholder — biological behaviour is unchanged.
    const profile = entity.intelligenceProfile
      || KnowledgeBuilder.createObjectProfile(entity)
      || KnowledgeBuilder.createImmediateFallback(entity.name || 'creature.glb');
    const id = profile.identity || {};

    const entry = {
      id: key,
      displayName: id.commonName || entity.name || 'Marine Entity',
      scientificName: id.scientificName || '—',
      category: id.taxon || entity.category || entity.entityType || 'Marine Life',
      discoveredAt: new Date().toLocaleTimeString(),
      depth: `${Math.abs(entity.model?.position?.y || entity.position?.y || 0).toFixed(1)} m`,
      habitat: profile.ecology?.habitat || 'Pelagic Ocean',
      diet: profile.ecology?.diet || (profile.ecosystem?.predator ? 'Carnivore' : 'Herbivore/Planktivore'),
      dataSource: profile.sources?.[0] || 'Ocean Intelligence Registry'
    };

    this.discoveries.set(key, entry);
    console.log(`[OceanCodex] Discovered: ${entry.displayName}`);

    for (const cb of this.onDiscoveryCallbacks) {
      cb(entry, this.discoveries.size);
    }
  }

  getAll() {
    return Array.from(this.discoveries.values());
  }

  getCount() {
    return this.discoveries.size;
  }

  /**
   * Builds the browsable encyclopedia from the DISCOVERED GLB assets (asset-driven, zero
   * per-species code). Biology comes exclusively from the resolved canonical KnowledgeProfile
   * in the KnowledgeCache — unresolved entries show graceful placeholders, never fabricated
   * facts. The flat entry shape here matches what UIManager's directory/dossier renders.
   */
  getEncyclopediaEntries() {
    const list = [];

    for (const asset of DISCOVERED_ASSETS) {
      const filename = asset.filename;

      // Discovery state: unlocked by in-world proximity (keyed by filename or display name)
      const isDiscovered = this.discoveries.has(filename) || this.discoveries.has(asset.displayName);

      // Best available biology = resolved canonical profile from local master knowledge or cache
      const profile = KnowledgeCache.get(filename) || KnowledgeBuilder.findLocalProfile(filename) || null;
      const id = profile?.identity || {};
      const tax = profile?.classification || {};
      const eco = profile?.ecology || {};
      const behav = profile?.behavior || {};

      // Resolved = there is a verified identity to show: a species-level scientific
      // name OR verified higher-rank taxonomy (class/family/genus) even when the
      // species itself is ambiguous. The un-hallucinated 'unresolved' fallback (all
      // taxonomy null, source:'unresolved') is never counted as resolved.
      const hasTaxonomy = !!(tax.class || tax.family || tax.genus);
      const notUnresolved = !!(profile && profile._meta?.source !== 'unresolved');
      const isResolved = !!(profile && profile._meta?.isLoaded && notUnresolved && (id.scientificName || hasTaxonomy));

      // Resolution status badge — deterministic, never permanently "Resolving…"
      // RESOLVED       : has a verified scientific name from authoritative source
      // PARTIALLY RESOLVED : taxonomy known (family/genus/class) but no exact species
      // SPECIES NOT RESOLVED : research complete, no authoritative match
      // PENDING        : no profile in cache yet (lazy-resolve will run in dossier)
      let resolutionStatus;
      if (!profile) {
        resolutionStatus = 'PENDING';
      } else if (profile._meta?.source === 'unresolved') {
        resolutionStatus = 'SPECIES NOT RESOLVED';
      } else if (id.scientificName && !id.ambiguous) {
        resolutionStatus = 'RESOLVED';
      } else if (hasTaxonomy) {
        resolutionStatus = 'PARTIALLY RESOLVED';
      } else {
        resolutionStatus = 'SPECIES NOT RESOLVED';
      }

      // Scientific name: real name when available, null otherwise (status badge covers the rest —
      // never show 'Resolving…' as if it were a scientific name)
      const scientificName = id.scientificName || null;

      let social = null;
      if (behav.social) social = behav.social;
      else if (behav.schooling === true) social = 'Schooling';
      else if (behav.schooling === false) social = 'Solitary';

      list.push({
        key: filename,
        commonName: id.commonName || asset.displayName,
        scientificName,
        icon: id.icon || asset.icon,
        category: asset.uiCategory, // coarse bucket — matches encyclopedia filter tabs
        // Full taxonomy chain — only verified fields (null when unavailable, never fabricated)
        taxonomy: {
          kingdom: tax.kingdom || null,
          phylum:  tax.phylum  || null,
          className: tax.class || null,
          order:   tax.order   || null,
          family:  tax.family  || null,
          genus:   tax.genus   || null,
          species: id.scientificName || null, // species = genus + specific epithet (= scientificName)
        },
        depth: eco.depth || null,
        distribution: eco.distribution || null,
        size: profile?.morphology?.size || null,
        diet: eco.diet || null,
        habitat: eco.habitat || null,
        locomotion: behav.movement || null,
        activity: behav.activity || null,
        verticalMovement: behav.verticalMovement || null,
        social,
        conservationStatus: profile?.conservationStatus || null,
        reproduction: profile?.reproduction || null,
        interestingFact: profile?.interestingFact || null,
        sources: profile?.sources || null,
        isDiscovered,
        isResolved,
        resolutionStatus,
      });
    }

    return list;
  }

  /**
   * Lazily resolve a single encyclopedia entry that isn't cached yet (e.g. a species
   * the player has never approached in-world, so it shows "Resolving…"). Runs the SAME
   * real pipeline (Gemini research → WoRMS-direct) via KnowledgeBuilder, which caches
   * any genuine result; the un-hallucinated 'unresolved' fallback is never cached, so
   * this can be retried. Returns the recomputed flat entry (or null) so the dossier can
   * re-render. Never fabricates; guarded against duplicate in-flight resolves.
   */
  async resolveForEncyclopedia(filename) {
    if (!filename) return null;
    const profile = KnowledgeCache.get(filename) || KnowledgeBuilder.findLocalProfile(filename);
    if (profile) {
      KnowledgeCache.save(filename, profile);
    } else {
      await KnowledgeBuilder.buildProfile(filename);
    }
    const entries = this.getEncyclopediaEntries();
    return entries.find((e) => e.key === filename) || null;
  }
}
