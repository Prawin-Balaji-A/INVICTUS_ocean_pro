/**
 * KnowledgeCache.js
 * Caches the fully normalized knowledge profile in localStorage to prevent
 * redundant backend/API requests.
 */

// Bump whenever the normalized KnowledgeProfile shape or the intelligence
// pipeline changes. Any cached entry stamped with an older (or missing) version
// is discarded on read, so previously-cached THIN profiles (e.g. the taxonomy-
// only "Mammalia" sperm-whale card) can never survive a pipeline upgrade and
// keep short-circuiting live research. This is a performance cache, not a
// datastore — dropping stale entries just triggers a fresh live resolve.
// v4: taxonomy-only WoRMS resolves are now cacheable (so Family/Genus reach the
// encyclopedia) and upgraded to rich in the background — invalidate v3 entries.
const SCHEMA_VERSION = 4;

export class KnowledgeCache {
  static getCacheKey(assetName, aphiaId = null) {
    if (aphiaId) {
      return `knowledge_aphia_${aphiaId}`;
    }
    return `knowledge_asset_${assetName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  static get(assetName) {
    if (typeof localStorage === 'undefined') return null;
    // We primarily lookup by assetName before resolution
    const key = this.getCacheKey(assetName);
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Discard entries from an older pipeline/schema — they may be thin.
        if (!parsed._meta || parsed._meta.schema !== SCHEMA_VERSION) {
          localStorage.removeItem(key);
          return null;
        }
        // Purge any stale cache entry containing debugging text or raw asset filename
        const factStr = parsed.interestingFact || '';
        if (factStr.includes('asset filename') || factStr.includes('.glb') || factStr.includes('ambiguous at the species level')) {
          localStorage.removeItem(key);
          return null;
        }
        return parsed;
      } catch (e) {
        console.warn('[KnowledgeCache] Failed to parse cache', e);
      }
    }
    return null;
  }

  static save(assetName, profile) {
    if (typeof localStorage === 'undefined') return;
    try {
      // Stamp the current schema version so a future pipeline upgrade can
      // invalidate this entry rather than serve a stale/thin shape.
      if (profile && profile._meta) profile._meta.schema = SCHEMA_VERSION;

      // Always cache by assetName so subsequent identical files load fast
      const keyByAsset = this.getCacheKey(assetName);
      localStorage.setItem(keyByAsset, JSON.stringify(profile));

      // Also cache by AphiaID if available for cross-asset reasoning later
      if (profile.identity && profile.identity.aphiaId) {
        const keyByAphia = this.getCacheKey(null, profile.identity.aphiaId);
        localStorage.setItem(keyByAphia, JSON.stringify(profile));
      }
    } catch (e) {
      console.warn('[KnowledgeCache] Failed to save cache', e);
    }
  }
}
