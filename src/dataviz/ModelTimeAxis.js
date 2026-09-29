/**
 * ModelTimeAxis — pure, DOM-free, dependency-free helpers for Phase 7 (Time Dimension).
 *
 * These functions manipulate ONLY the real model time axis (`modelAxes.times[]`, a list of
 * verbatim ISO-8601 UTC strings returned by the backend) and the Argo observation window.
 * They NEVER fabricate a timestamp: every value returned either is a real axis entry, an
 * index into it, or a formatted view of a string that already exists. There is deliberately
 * NO use of `new Date(...)` for display — parsing an ISO string into a Date and re-emitting
 * it risks a timezone shift that would silently rewrite the real UTC timestamp. Everything is
 * done by string-splitting so the underlying ISO is preserved exactly.
 *
 * Kept separate from DataVizPanel (UI/rendering) so it is trivially unit-testable with no DOM.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Clamp an index into [0, len-1] and coerce to an integer. For an empty axis (len<=0) or a
 * non-finite idx, returns 0 — callers additionally guard on `times.length` before use.
 */
export function clampIndex(idx, len) {
  const n = Math.trunc(Number(idx));
  if (!Number.isFinite(n)) return 0;
  if (!Number.isFinite(len) || len <= 0) return 0;
  if (n < 0) return 0;
  if (n > len - 1) return len - 1;
  return n;
}

/**
 * Exact index of `iso` in `times`, or -1 if it is not a verbatim entry. No nearest-match,
 * no approximation — the caller must render the exact timestamp the axis actually contains.
 */
export function indexForIso(times, iso) {
  if (!Array.isArray(times) || !iso) return -1;
  return times.indexOf(iso);
}

/**
 * Global index of the NEWEST step whose calendar day (YYYY-MM-DD, UTC) equals `day`, or -1
 * if that day is absent. Used when the Date <select> changes: pick the latest real time on
 * that day (matches the app's newest-first default) and resolve its canonical global index.
 * Scans for the last match; assumes the axis is chronologically ordered but does not require it.
 */
export function newestIndexForDay(times, day) {
  if (!Array.isArray(times) || !day) return -1;
  let found = -1;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (typeof t === 'string' && t.slice(0, 10) === day) found = i; // keep the last (newest) match
  }
  return found;
}

/**
 * Format a real ISO-8601 UTC timestamp for display WITHOUT constructing a Date (no timezone
 * shift). Pure string surgery on "YYYY-MM-DDTHH:MM:SS[.sss]Z".
 *   formatModelTime('2026-07-30T00:00:00Z')
 *     → { date:'30 Jul 2026', time:'00:00', label:'00:00 UTC', iso:'2026-07-30T00:00:00Z' }
 * A malformed/empty input yields em-dash placeholders and echoes the input as `iso` (never throws).
 */
export function formatModelTime(iso) {
  if (typeof iso !== 'string' || iso.indexOf('T') === -1) {
    return { date: '—', time: '—', label: '—', iso: iso || '' };
  }
  const [datePart, timePartRaw] = iso.split('T');
  const dseg = datePart.split('-');            // [YYYY, MM, DD]
  let date = datePart;
  if (dseg.length === 3) {
    const y = dseg[0];
    const mi = parseInt(dseg[1], 10) - 1;
    const d = parseInt(dseg[2], 10);
    const mon = (mi >= 0 && mi < 12) ? MONTHS[mi] : dseg[1];
    if (Number.isFinite(d) && y) date = `${d} ${mon} ${y}`;
  }
  // HH:MM from the time part (strip seconds, milliseconds, and the trailing Z/offset).
  const tseg = (timePartRaw || '').replace('Z', '').split(':');
  const hh = (tseg[0] || '').padStart(2, '0');
  const mm = (tseg[1] || '00').slice(0, 2);
  const time = (tseg.length >= 2) ? `${hh}:${mm}` : '—';
  const label = (time !== '—') ? `${time} UTC` : '—';
  return { date, time, label, iso };
}

/**
 * Convert a <input type="datetime-local"> value ("YYYY-MM-DDTHH:MM" or with seconds) into a
 * canonical UTC ISO string "YYYY-MM-DDTHH:MM:00Z" (seconds normalised to :00). The observation
 * window is labelled UTC in the UI, so the wall-clock value is taken as UTC directly (no shift).
 * Empty / falsy / malformed input → null (the caller then omits the bound and the server uses
 * its own default window). Never invents a time.
 */
export function isoFromLocalInput(localValue) {
  if (!localValue || typeof localValue !== 'string') return null;
  // Accept "YYYY-MM-DDTHH:MM" optionally followed by ":SS" (and ignore anything after).
  const m = localValue.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:00Z`;
}

/**
 * Validate an observation time window. Both bounds are optional (null = open-ended, server
 * default applies). When BOTH are present, From must not be after To. ISO-8601 UTC strings in
 * identical format compare correctly with a plain string comparison (lexical == chronological).
 *   → { ok:true } | { ok:false, error:'<message>' }
 */
export function validateWindow(startIso, endIso) {
  if (startIso && endIso && startIso > endIso) {
    return { ok: false, error: 'From time must be before To time.' };
  }
  return { ok: true };
}

/**
 * Stable cache key for one model field request. Includes every parameter that changes the
 * bytes returned so distinct requests never collide and identical ones always hit. `bbox` is
 * serialised deterministically (array → CSV, object → JSON, else String).
 */
export function fieldCacheKey({ dataset, variable, depth, time, bbox } = {}) {
  let bboxStr;
  if (Array.isArray(bbox)) bboxStr = bbox.join(',');
  else if (bbox && typeof bbox === 'object') bboxStr = JSON.stringify(bbox);
  else bboxStr = String(bbox == null ? '' : bbox);
  return [
    dataset == null ? '' : dataset,
    variable == null ? '' : variable,
    depth == null ? '' : depth,
    time == null ? '' : time,
    bboxStr
  ].join('|');
}

/**
 * Bounded LRU cache for decoded model fields (default 8 entries). Keeps memory flat while
 * making same-timestamp re-selection and small back-and-forth scrubbing zero-fetch. Least
 * recently USED (read or written) is evicted first. Values are opaque (whatever setField wants).
 */
export class BoundedFieldCache {
  constructor(max = 8) {
    this.max = Math.max(1, Math.trunc(max) || 1);
    this._map = new Map();   // insertion order == recency order (oldest first)
  }

  get(key) {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key);
    this._map.delete(key);   // re-insert at the end to mark most-recently-used
    this._map.set(key, val);
    return val;
  }

  has(key) {
    return this._map.has(key);
  }

  set(key, val) {
    if (this._map.has(key)) this._map.delete(key);   // refresh recency
    this._map.set(key, val);
    while (this._map.size > this.max) {
      const oldest = this._map.keys().next().value;  // first key = least recently used
      this._map.delete(oldest);
    }
    return this;
  }

  clear() {
    this._map.clear();
  }

  get size() {
    return this._map.size;
  }
}
