/**
 * OceanDataService — format-agnostic fetch client for the ocean-data REST API.
 *
 * The API is served by the Python ingestion service (FastAPI) and reached in
 * dev through the Vite proxy at `/api/datasets`, `/api/observations`,
 * `/api/model`. The frontend NEVER sees the original source format (ERDDAP,
 * NetCDF, OPeNDAP …) — it only consumes the canonical schema returned here.
 *
 * This client never fabricates data. On any network or HTTP error it throws a
 * {@link DataError} carrying the URL, status and server detail so callers can
 * surface an explicit error / "no data available" state (spec §33, §40).
 */

/** Error raised for any failed data request. Carries diagnostic context. */
export class DataError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'DataError';
    /** @type {string|undefined} */ this.url = info.url;
    /** @type {number|undefined} */ this.status = info.status;
    /** @type {string|undefined} */ this.detail = info.detail;
    /** @type {boolean|undefined} */ this.isUpstreamUnavailable = info.isUpstreamUnavailable || false;
    if (info.cause) this.cause = info.cause;
  }

  /** Human-readable one-liner for status panels. */
  toDisplay() {
    if (this.isUpstreamUnavailable || this.status === 503) {
      return 'INCOIS ERDDAP temporarily unavailable — HTTP 503 (No synthetic data used)';
    }
    if (this.status) return `${this.message} — ${this.detail || 'no detail'}`;
    return this.message;
  }
}

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    // ECONNREFUSED typically means Node :3000 is not running (Vite proxy target unreachable).
    // Direct the developer to the correct startup command rather than showing a cryptic error.
    const hint = url.startsWith('/api')
      ? ' Start the full stack with: npm run dev'
      : '';
    throw new DataError(`Cannot reach the ocean-data service${hint}`, { url, cause: e });
  }
  if (!res.ok) {
    // The Node proxy injects X-Ocean-Source so we can name the upstream service
    // (e.g. "INCOIS ERDDAP (Argo floats)") in the error message.
    const oceanSource = res.headers.get('X-Ocean-Source') || '';
    let detail = '';
    let upstreamDetail = '';
    let isUpstreamUnavailable = false;
    let jsonBody = null;
    try {
      jsonBody = await res.json();
      if (jsonBody && (jsonBody.status === 'upstream_unavailable' || res.status === 503 || jsonBody.httpStatus === 503)) {
        isUpstreamUnavailable = true;
      }
      upstreamDetail = jsonBody && (jsonBody.detail || jsonBody.message) ? (jsonBody.detail || jsonBody.message) : '';
      detail = upstreamDetail || JSON.stringify(jsonBody);
    } catch {
      try { detail = await res.text(); } catch { detail = ''; }
    }

    if (res.status === 503 || isUpstreamUnavailable) {
      const err = new DataError('INCOIS ERDDAP temporarily unavailable', {
        url,
        status: 503,
        detail: 'HTTP 503',
        isUpstreamUnavailable: true,
      });
      throw err;
    }

    // Produce a human-readable label for the error source
    const sourceLabel = oceanSource || (url.includes('/observations') ? 'INCOIS ERDDAP (Argo floats)' : 'ocean-data service');
    const statusLabel = res.status === 500
      ? `HTTP 500 — ${sourceLabel}`
      : res.status === 502
        ? `${sourceLabel} unreachable (HTTP 502)`
        : `HTTP ${res.status}`;
    throw new DataError(`Data service returned ${statusLabel}`, {
      url, status: res.status,
      detail: (upstreamDetail || String(detail)).slice(0, 400) ||
        (res.status === 500 ? `Check that all services are running: npm run dev` : ''),
    });
  }
  return res.json();
}

export class OceanDataService {
  constructor(base = '/api') {
    this.base = base;
  }

  /** All datasets in the catalog (each with a `status`: online / unreachable). */
  async listDatasets() {
    return getJSON(`${this.base}/datasets`);
  }

  /** One dataset's metadata (variables, spatial/time/depth ranges, source). */
  async getDataset(id) {
    return getJSON(`${this.base}/datasets/${encodeURIComponent(id)}`);
  }

  /** Just the variable list for a dataset. */
  async getVariables(id) {
    return getJSON(`${this.base}/datasets/${encodeURIComponent(id)}/variables`);
  }

  /**
   * Observations (e.g. Argo float latest positions), server-side subset by
   * bounding box + optional time window (spec §28 — the whole dataset is never
   * shipped to the browser).
   * @returns {Promise<{dataset:string,count:number,observations:Array}>}
   */
  async listObservations({ dataset, bbox = null, start = null, end = null, limit = null } = {}) {
    if (!dataset) throw new DataError('listObservations requires a dataset id');
    const p = new URLSearchParams({ dataset });
    if (bbox) {
      for (const k of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
        if (bbox[k] !== null && bbox[k] !== undefined && bbox[k] !== '') {
          p.set(k, String(bbox[k]));
        }
      }
    }
    if (start) p.set('start', start);
    if (end) p.set('end', end);
    if (limit) p.set('limit', String(limit));
    return getJSON(`${this.base}/observations?${p.toString()}`);
  }

  /**
   * One platform's depth profile (levels with depth/pressure, values, QC flags),
   * for the given cycle or the most recent cycle when omitted.
   */
  async getProfile(platformId, { dataset, cycle = null } = {}) {
    if (!dataset) throw new DataError('getProfile requires a dataset id');
    const p = new URLSearchParams({ dataset });
    if (cycle !== null && cycle !== undefined) p.set('cycle', String(cycle));
    return getJSON(`${this.base}/observations/${encodeURIComponent(platformId)}/profile?${p.toString()}`);
  }

  /**
   * A gridded model/analysis field, server-side subset to a single time + single
   * depth + bounding box (spec §8-12, §28 — the full grid is never shipped to the
   * browser). Returns the canonical ModelField: `values[latIndex][lonIndex]` with
   * matching `latitude`/`longitude` arrays, real `units`, and provenance in
   * `metadata` (missing cells are `null`, never a fill sentinel).
   * @returns {Promise<{datasetId:string,variable:string,units:string,time:string,
   *   depth:number,latitude:number[],longitude:number[],
   *   values:Array<Array<number|null>>,dimensions:object,metadata:object}>}
   */
  async getModelField({ dataset, variable, time = null, depth = null, bbox = null, stride = null } = {}) {
    if (!dataset) throw new DataError('getModelField requires a dataset id');
    if (!variable) throw new DataError('getModelField requires a variable');
    const p = new URLSearchParams({ dataset, variable });
    if (time) p.set('time', time);
    if (depth !== null && depth !== undefined && depth !== '') p.set('depth', String(depth));
    if (bbox) {
      for (const k of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
        if (bbox[k] !== null && bbox[k] !== undefined && bbox[k] !== '') {
          p.set(k, String(bbox[k]));
        }
      }
    }
    if (stride) p.set('stride', String(stride));
    return getJSON(`${this.base}/model/field?${p.toString()}`);
  }

  /**
   * A depth-RESOLVED model/analysis volume — the 3-D sibling of
   * {@link getModelField}, server-side subset to a single time + lat/lon box but
   * keeping the FULL real depth axis (optionally limited to [depthMin, depthMax]).
   * Used to extract a real isosurface through the water column (Phase 8). Returns
   * the canonical ModelVolume: `values[depthIndex][latIndex][lonIndex]` with a
   * real `depths[]` array and matching `latitude`/`longitude`. Missing cells are
   * `null` (never zero, never interpolated); the full global grid is never shipped.
   * @returns {Promise<{datasetId:string,variable:string,units:string,time:string,
   *   depths:number[],depthUnits:string,latitude:number[],longitude:number[],
   *   values:Array<Array<Array<number|null>>>,dimensions:object,metadata:object}>}
   */
  async getModelVolume({ dataset, variable, time = null, bbox = null, stride = null,
                         depthMin = null, depthMax = null } = {}) {
    if (!dataset) throw new DataError('getModelVolume requires a dataset id');
    if (!variable) throw new DataError('getModelVolume requires a variable');
    const p = new URLSearchParams({ dataset, variable });
    if (time) p.set('time', time);
    if (depthMin !== null && depthMin !== undefined && depthMin !== '') p.set('depthMin', String(depthMin));
    if (depthMax !== null && depthMax !== undefined && depthMax !== '') p.set('depthMax', String(depthMax));
    if (bbox) {
      for (const k of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
        if (bbox[k] !== null && bbox[k] !== undefined && bbox[k] !== '') {
          p.set(k, String(bbox[k]));
        }
      }
    }
    if (stride) p.set('stride', String(stride));
    return getJSON(`${this.base}/model/volume?${p.toString()}`);
  }

  /**
   * The real coordinate axes (available times + depth levels) of a gridded
   * dataset, so a caller can build valid {@link getModelField} requests.
   * @returns {Promise<{dataset:string,times:string[],depths:number[],depthUnits:string}>}
   */
  async getModelAxes(dataset) {
    if (!dataset) throw new DataError('getModelAxes requires a dataset id');
    return getJSON(`${this.base}/model/axes?dataset=${encodeURIComponent(dataset)}`);
  }
}
