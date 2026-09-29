// server/tools/worms.js

export const searchWoRMSDeclaration = {
  name: "searchWoRMS",
  description: "Searches the World Register of Marine Species (WoRMS) database for factual taxonomic and identity information about a marine species by its common or scientific name.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "The species name to look up (e.g., 'Yellow Tang', 'Zebrasoma flavescens', 'Octopus')"
      }
    },
    required: ["query"]
  }
};

export async function searchWoRMS({ query }) {
  try {
    let records = await fetchWoRMS(`https://www.marinespecies.org/rest/AphiaRecordsByVernacular/${encodeURIComponent(query)}`);
    
    if (!records || records.length === 0) {
      records = await fetchWoRMS(`https://www.marinespecies.org/rest/AphiaRecordsByName/${encodeURIComponent(query)}?like=false&marine_only=false`);
    }

    if (!records || records.length === 0) {
      const matchRes = await fetchWoRMS(`https://www.marinespecies.org/rest/AphiaRecordsByMatchNames?scientificnames%5B%5D=${encodeURIComponent(query)}`);
      if (matchRes && matchRes.length > 0) {
        records = matchRes[0]; 
      }
    }
    
    if (!records || records.length === 0) {
      return { found: false, message: "No match found in WoRMS." };
    }
    
    // Filter out invalid/fossil records to reduce payload size to Gemini
    const validCandidates = records.filter(r => 
      r.status === 'accepted' && 
      (r.isMarine === 1 || r.isMarine === null) &&
      (r.isExtinct === 0 || r.isExtinct === null)
    );

    if (validCandidates.length === 0) {
      return { found: false, message: "Matches found, but none are accepted extant marine taxa." };
    }

    // Return the top relevant candidates
    return {
      found: true,
      results: validCandidates.slice(0, 5).map(r => ({
        aphiaId: r.AphiaID,
        scientificName: r.scientificname,
        rank: r.rank,
        status: r.status,
        url: r.url,
        taxonomy: {
          kingdom: r.kingdom,
          phylum: r.phylum,
          className: r.class,
          order: r.order,
          family: r.family,
          genus: r.genus
        }
      }))
    };
  } catch (error) {
    return { error: true, message: error.message };
  }
}

async function fetchWoRMS(url) {
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`WoRMS API returned ${response.status}`);
  return await response.json();
}
