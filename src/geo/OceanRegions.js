import MARINE_REGIONS from './marine_regions.json';

/**
 * OceanRegions — resolve the authoritative name of the ocean / sea a geographic
 * point falls in, by point-in-polygon against a bundled, real boundary dataset.
 *
 * Data source (bundled, offline): Natural Earth 1:110m `geography_marine_polys`
 * (public domain — https://www.naturalearthdata.com/). This is a real, widely-used
 * cartographic reference for named ocean/sea label regions (Bay of Bengal, Arabian
 * Sea, Indian Ocean, …). We import it as a JSON module so lookup is synchronous and
 * works fully offline; only the English `name` is retained and coordinate precision
 * is reduced to 3 decimals (≈110 m) — the boundary topology itself is unaltered.
 *
 * NOTHING here is fabricated: a point that matches a polygon returns that polygon's
 * real name; a point that matches none returns `null` (the caller then shows only
 * the real coordinates, never an invented region name).
 *
 * Coordinates are (lon, lat) in degrees — the same order used throughout the geo
 * pipeline (GeoTransform.lonLatToWorld).
 */

const FEATURES = Array.isArray(MARINE_REGIONS?.features) ? MARINE_REGIONS.features : [];

/** Normalize longitude into [-180, 180] so callers can pass 0..360 or wrapped values. */
function wrapLon(lon) {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  // ((-180)) maps to -180 which is fine; guard −0.
  if (Object.is(x, -0)) x = 0;
  return x;
}

/**
 * Even-odd ray casting over ALL rings of a single polygon (exterior + holes).
 * A point inside a hole gets an even crossing count → correctly reported outside.
 * @param {number} lon @param {number} lat @param {number[][][]} rings
 */
function inPolygon(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersects = ((yi > lat) !== (yj > lat))
        && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (intersects) inside = !inside;
    }
  }
  return inside;
}

/**
 * The real name of the ocean/sea containing (lon, lat), or `null` if the point is
 * outside every named marine polygon (e.g. over land, or an unnamed gap). The name
 * is returned exactly as stored in the authoritative dataset.
 *
 * @param {number} lon degrees east  (−180..180, or any value; it is wrapped)
 * @param {number} lat degrees north (−90..90)
 * @returns {string|null}
 */
export function regionName(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = wrapLon(lon);
  for (const f of FEATURES) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      if (inPolygon(x, lat, g.coordinates)) return f.properties?.name || null;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        if (inPolygon(x, lat, poly)) return f.properties?.name || null;
      }
    }
  }
  return null;
}

/**
 * Display form: the real region name in UPPERCASE (the badge/UI convention), or
 * `null` when unresolved. Never fabricates — returns null so the caller can show
 * coordinates alone.
 */
export function regionNameUpper(lon, lat) {
  const n = regionName(lon, lat);
  return n ? n.toUpperCase() : null;
}

/** Number of named regions available (for diagnostics / tests). */
export function regionCount() {
  return FEATURES.length;
}
