export function createSpeciesProfile(data = {}) {
  return {
    id: data.id || null,
    assetName: data.assetName || null,
    displayName: data.displayName || null,
    scientificName: data.scientificName || null,
    aphiaId: data.aphiaId || null,
    ambiguous: data.ambiguous || false,

    taxonomy: {
      kingdom: data.taxonomy?.kingdom || null,
      phylum: data.taxonomy?.phylum || null,
      className: data.taxonomy?.className || null, // className because 'class' is reserved
      order: data.taxonomy?.order || null,
      family: data.taxonomy?.family || null,
      genus: data.taxonomy?.genus || null,
    },

    source: {
      provider: data.source?.provider || "unknown",
      url: data.source?.url || null,
    },

    biology: {
      type: null,
      habitat: null,
      preferredDepth: null,
      schooling: null,
      diet: null,
      predator: null,
    },

    behavior: {
      speed: null,
      turning: null,
      preferredDepth: null,
      social: null,
      fearResponse: null,
    },
  };
}

export function createFallbackProfile(assetName, displayName) {
  return createSpeciesProfile({
    id: displayName.toLowerCase().replace(/\s+/g, '_'),
    assetName: assetName,
    displayName: displayName,
    scientificName: null,
    aphiaId: null,
    ambiguous: false, // fallback implies we just don't know, not necessarily ambiguous matching
    source: {
      provider: "local-fallback",
    },
  });
}
