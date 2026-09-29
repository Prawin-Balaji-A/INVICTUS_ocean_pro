import { createSpeciesProfile, createFallbackProfile } from './SpeciesProfile.js';

/**
 * Normalizes a filename or asset name string.
 * e.g., 'yellow_tang.glb' -> 'Yellow Tang'
 */
export function normalizeName(filename) {
  let name = filename.replace(/\.glb$/i, '');
  name = name.replace(/[_-]/g, ' ');
  return name.replace(/\b\w/g, char => char.toUpperCase()).trim();
}

/**
 * Normalizes for cache key (lowercase, underscored)
 */
function toCacheKey(displayName) {
  return 'species_cache_' + displayName.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Resolves a species from WoRMS API.
 */
export async function resolveSpecies(assetName) {
  const displayName = normalizeName(assetName);
  const cacheKey = toCacheKey(displayName);
  
  // Check local cache
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      return createSpeciesProfile(data);
    } catch (e) {
      console.warn('[SpeciesResolver] Failed to parse cache', e);
    }
  }

  const fallback = createFallbackProfile(assetName, displayName);

  try {
    // 1. Try vernacular match
    let records = await fetchWoRMS(`https://www.marinespecies.org/rest/AphiaRecordsByVernacular/${encodeURIComponent(displayName)}`);
    
    // 2. Try match names (scientific)
    if (!records || records.length === 0) {
      const matchRes = await fetchWoRMS(`https://www.marinespecies.org/rest/AphiaRecordsByMatchNames?scientificnames%5B%5D=${encodeURIComponent(displayName)}`);
      if (matchRes && matchRes.length > 0) {
        records = matchRes[0]; // Returns array of arrays
      }
    }
    
    // If still no records, return fallback (unresolved)
    if (!records || records.length === 0) {
      console.log(`[SpeciesResolver] Asset: ${assetName} | Name: ${displayName} | NO MATCH (Fallback)`);
      return fallback;
    }
    
    // Filter for accepted and (marine/unknown)
    const validCandidates = records.filter(r => 
      r.status === 'accepted' && 
      (r.isMarine === 1 || r.isMarine === null) &&
      (r.isExtinct === 0 || r.isExtinct === null)
    );
    
    if (validCandidates.length === 0) {
      console.log(`[SpeciesResolver] Asset: ${assetName} | Name: ${displayName} | NO VALID CANDIDATES (Fallback)`);
      return fallback;
    }
    
    // Candidate Selection Strategy
    // Look for species-level records
    const speciesCandidates = validCandidates.filter(r => r.rank === 'Species');
    
    let chosenRecord = null;
    let ambiguous = false;
    
    if (speciesCandidates.length === 1) {
      chosenRecord = speciesCandidates[0];
    } else if (speciesCandidates.length > 1) {
      // Multiple species-level records => ambiguous
      ambiguous = true;
      chosenRecord = speciesCandidates[0]; // Just take one for higher taxonomy, but we will clear scientificName
    } else {
      // No species-level records (e.g. Genus, Family) => ambiguous generic
      ambiguous = true;
      chosenRecord = validCandidates[0];
    }
    
    const profile = createSpeciesProfile({
      id: cacheKey.replace('species_cache_', ''),
      assetName,
      displayName,
      scientificName: ambiguous ? null : chosenRecord.scientificname,
      aphiaId: ambiguous ? null : chosenRecord.AphiaID,
      ambiguous,
      taxonomy: {
        kingdom: chosenRecord.kingdom || null,
        phylum: chosenRecord.phylum || null,
        className: chosenRecord.class || null,
        order: chosenRecord.order || null,
        family: chosenRecord.family || null,
        genus: chosenRecord.genus || null,
      },
      source: {
        provider: 'WoRMS',
        url: chosenRecord.url || null
      }
    });
    
    // Log for development
    console.log(`[SpeciesResolver] Asset: ${assetName}`);
    console.log(`Name: ${profile.displayName}`);
    console.log(`Scientific name: ${profile.scientificName || 'AMBIGUOUS/NULL'}`);
    console.log(`AphiaID: ${profile.aphiaId || 'AMBIGUOUS/NULL'}`);
    console.log(`Source: ${profile.source.provider}`);
    
    // Cache it
    localStorage.setItem(cacheKey, JSON.stringify(profile));
    
    return profile;
    
  } catch (error) {
    console.warn('[SpeciesResolver] API or Network Error, using fallback:', error);
    return fallback;
  }
}

async function fetchWoRMS(url) {
  // Bound every WoRMS request with an abort timeout. WITHOUT this, a stalled
  // connection to marinespecies.org leaves the fetch pending indefinitely, so
  // buildProfile() (awaited by OceanCodex) never returns and the focus card is
  // frozen forever on "Resolving species…" — even for a species WoRMS could resolve.
  // On timeout the fetch rejects, resolveSpecies()'s try/catch returns the honest
  // un-resolved fallback, and a later approach can retry. No facts are fabricated and
  // the WoRMS resolution hierarchy is unchanged — this only bounds the wait.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) throw new Error(`WoRMS API returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
