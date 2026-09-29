// server/tools/fishbase.js

export const searchFishBaseDeclaration = {
  name: "searchFishBase",
  description: "Searches FishBase database for ecological traits, biological swimming speeds, depth ranges, and diet information for fish species.",
  parameters: {
    type: "OBJECT",
    properties: {
      scientificName: {
        type: "STRING",
        description: "Scientific name of the fish species (e.g., 'Zebrasoma flavescens', 'Carcharhinus amblyrhynchos')"
      }
    },
    required: ["scientificName"]
  }
};

const cache = new Map();

export async function searchFishBase({ scientificName }) {
  if (!scientificName) {
    return { found: false, message: "scientificName is required." };
  }

  const cleanName = scientificName.trim();
  if (cache.has(cleanName)) {
    return cache.get(cleanName);
  }

  try {
    const parts = cleanName.split(' ');
    const genus = parts[0] || '';
    const species = parts[1] || '';

    // FishBase API endpoint (using open fishbase / seaaroundus or species endpoint)
    const url = `https://fishbase.ropensci.org/species?Genus=${encodeURIComponent(genus)}&Species=${encodeURIComponent(species)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const fallbackResult = {
        found: false,
        message: `FishBase returned status ${response.status}. No additional data.`
      };
      cache.set(cleanName, fallbackResult);
      return fallbackResult;
    }

    const data = await response.json();
    if (data && data.data && data.data.length > 0) {
      const sp = data.data[0];
      const result = {
        found: true,
        source: 'FishBase',
        species: `${sp.Genus} ${sp.Species}`,
        fbName: sp.FBname || null,
        depthRangeShallow: sp.DepthRangeShallow || null,
        depthRangeDeep: sp.DepthRangeDeep || null,
        length: sp.Length || null,
        trophicLevel: sp.DemersPelag || null,
        dangerous: sp.Dangerous || null
      };
      cache.set(cleanName, result);
      return result;
    }

    const notFoundResult = { found: false, message: "Species not found in FishBase." };
    cache.set(cleanName, notFoundResult);
    return notFoundResult;
  } catch (error) {
    // Graceful error handling (timeout, network error, 429)
    const errResult = {
      found: false,
      message: `FishBase lookup failed or timed out: ${error.message}`
    };
    cache.set(cleanName, errResult);
    return errResult;
  }
}
