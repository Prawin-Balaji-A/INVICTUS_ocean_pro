// server/tools/erddap.js

export const searchERDDAPDeclaration = {
  name: "searchERDDAP",
  description: "Queries ERDDAP oceanographic servers for gridded or tabular ocean data such as Sea Surface Temperature (SST), salinity, and ocean currents.",
  parameters: {
    type: "OBJECT",
    properties: {
      datasetId: {
        type: "STRING",
        description: "ERDDAP dataset ID (e.g., 'jplMURSST41', 'erdHadISST')"
      },
      variable: {
        type: "STRING",
        description: "Variable to query (e.g., 'analysed_sst', 'salinity')"
      }
    },
    required: ["datasetId"]
  }
};

const cache = new Map();

export async function searchERDDAP({ datasetId, variable }) {
  const cacheKey = `${datasetId}_${variable || 'all'}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const url = `https://coastwatch.pfeg.noaa.gov/erddap/info/${encodeURIComponent(datasetId)}/index.json`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const fallback = {
        found: false,
        message: `ERDDAP server returned status ${response.status}. Using simulation fallback data.`
      };
      cache.set(cacheKey, fallback);
      return fallback;
    }

    const data = await response.json();
    const result = {
      found: true,
      source: 'ERDDAP NOAA CoastWatch',
      datasetId,
      status: 'active',
      info: data.table ? { columnNames: data.table.columnNames, rowCount: data.table.rows?.length } : null
    };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    const errResult = {
      found: false,
      message: `ERDDAP request failed or timed out: ${error.message}. Simulation fallback active.`
    };
    cache.set(cacheKey, errResult);
    return errResult;
  }
}
