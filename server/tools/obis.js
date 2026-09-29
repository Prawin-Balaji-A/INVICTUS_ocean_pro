// server/tools/obis.js

export const searchOBISDeclaration = {
  name: "searchOBIS",
  description: "Searches the Ocean Biodiversity Information System (OBIS) for geographic occurrence records, depth bounds, and marine habitat distributions.",
  parameters: {
    type: "OBJECT",
    properties: {
      scientificName: {
        type: "STRING",
        description: "Scientific name of the marine species"
      }
    },
    required: ["scientificName"]
  }
};

const cache = new Map();

export async function searchOBIS({ scientificName }) {
  if (!scientificName) {
    return { found: false, message: "scientificName is required." };
  }

  const cleanName = scientificName.trim();
  if (cache.has(cleanName)) {
    return cache.get(cleanName);
  }

  try {
    const url = `https://api.obis.org/v3/taxon/${encodeURIComponent(cleanName)}`;
    
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
        message: `OBIS returned status ${response.status}.`
      };
      cache.set(cleanName, fallbackResult);
      return fallbackResult;
    }

    const data = await response.json();
    if (data && data.results && data.results.length > 0) {
      const taxon = data.results[0];
      const result = {
        found: true,
        source: 'OBIS',
        taxonID: taxon.taxonID || null,
        scientificName: taxon.scientificName || cleanName,
        records: taxon.records || 0,
        marine: taxon.marine ?? true,
        brackish: taxon.brackish ?? false,
        depthMin: taxon.depth_min ?? null,
        depthMax: taxon.depth_max ?? null
      };
      cache.set(cleanName, result);
      return result;
    }

    const notFoundResult = { found: false, message: "Taxon not found in OBIS." };
    cache.set(cleanName, notFoundResult);
    return notFoundResult;
  } catch (error) {
    const errResult = {
      found: false,
      message: `OBIS lookup failed or timed out: ${error.message}`
    };
    cache.set(cleanName, errResult);
    return errResult;
  }
}
