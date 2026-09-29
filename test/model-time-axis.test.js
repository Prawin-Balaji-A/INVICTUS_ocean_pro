/**
 * Unit tests for the Phase 7 pure time-axis helpers (src/dataviz/ModelTimeAxis.js).
 *
 * Zero-install: uses only Node's built-in `node:test` + `node:assert/strict` — no
 * framework, no devDependency, no install step (safest for this no-VCS repo). Run with
 * `npm test` (which is `node --test`) or `node --test test/`.
 *
 * These cover the Part-30 requirements that are PURE LOGIC (no DOM / no network):
 *   - the real axis is preserved / never mutated by any helper;
 *   - slider index ↔ times[index] round-trips (clampIndex);
 *   - Date/Time ↔ exact ISO resolution (indexForIso, newestIndexForDay);
 *   - formatModelTime never alters the underlying ISO (no Date, no TZ shift);
 *   - Prev/Next boundary clamping;
 *   - validateWindow rejects From > To, accepts valid ranges and open/null bounds;
 *   - isoFromLocalInput correctness (incl. empty → null → server default);
 *   - BoundedFieldCache LRU eviction + fieldCacheKey stability.
 * DOM/network-bound items (stale-response guard, gated first render, visual-only
 * zero-fetch, Argo API wiring) are exercised by the manual browser tests instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampIndex,
  indexForIso,
  newestIndexForDay,
  formatModelTime,
  isoFromLocalInput,
  validateWindow,
  fieldCacheKey,
  BoundedFieldCache,
} from '../src/dataviz/ModelTimeAxis.js';

// A small, realistic slice of a real axis: chronological ISO-8601 UTC strings, with two
// distinct times on 2026-07-30 so "newest step of a day" is a meaningful, non-trivial pick.
const AXIS = [
  '2026-07-28T00:00:00Z',
  '2026-07-29T00:00:00Z',
  '2026-07-30T00:00:00Z',
  '2026-07-30T12:00:00Z',
  '2026-07-31T00:00:00Z',
];

// ---------------------------------------------------------------------------
// clampIndex — slider index ↔ times[index], and Prev/Next boundary clamping.
// ---------------------------------------------------------------------------
test('clampIndex keeps an in-range index unchanged', () => {
  assert.equal(clampIndex(3, AXIS.length), 3);
  assert.equal(clampIndex(0, AXIS.length), 0);
  assert.equal(clampIndex(AXIS.length - 1, AXIS.length), AXIS.length - 1);
});

test('clampIndex clamps below 0 and above len-1 (Prev at start / Next at end)', () => {
  // Prev from the first step stays at the first step.
  assert.equal(clampIndex(0 - 1, AXIS.length), 0);
  // Next from the last step stays at the last step (no wrap-around / no loop).
  assert.equal(clampIndex((AXIS.length - 1) + 1, AXIS.length), AXIS.length - 1);
  assert.equal(clampIndex(-100, AXIS.length), 0);
  assert.equal(clampIndex(9999, AXIS.length), AXIS.length - 1);
});

test('clampIndex truncates to an integer and defends against non-finite / empty', () => {
  assert.equal(clampIndex(3.9, AXIS.length), 3);
  assert.equal(clampIndex(Number.NaN, AXIS.length), 0);
  assert.equal(clampIndex(2, 0), 0);      // empty axis
  assert.equal(clampIndex(2, -1), 0);     // nonsensical length
});

test('every slider index maps back to the exact real axis entry', () => {
  for (let i = 0; i < AXIS.length; i++) {
    const idx = clampIndex(i, AXIS.length);
    assert.equal(AXIS[idx], AXIS[i]);     // index → times[index] is identity in range
  }
});

// ---------------------------------------------------------------------------
// indexForIso — Time <select> value ↔ exact global index (no nearest-match).
// ---------------------------------------------------------------------------
test('indexForIso returns the exact index of a real entry', () => {
  assert.equal(indexForIso(AXIS, '2026-07-30T12:00:00Z'), 3);
  assert.equal(indexForIso(AXIS, AXIS[0]), 0);
});

test('indexForIso returns -1 for a timestamp that is not a verbatim entry', () => {
  assert.equal(indexForIso(AXIS, '2026-07-30T06:00:00Z'), -1); // real-looking but not on axis
  assert.equal(indexForIso(AXIS, ''), -1);
  assert.equal(indexForIso(AXIS, null), -1);
  assert.equal(indexForIso(null, AXIS[0]), -1);
});

// ---------------------------------------------------------------------------
// newestIndexForDay — Date <select> change picks the newest real time that day.
// ---------------------------------------------------------------------------
test('newestIndexForDay returns the newest step whose UTC day matches', () => {
  assert.equal(newestIndexForDay(AXIS, '2026-07-30'), 3);   // 12:00Z, not 00:00Z
  assert.equal(newestIndexForDay(AXIS, '2026-07-28'), 0);
  assert.equal(newestIndexForDay(AXIS, '2026-07-31'), 4);
});

test('newestIndexForDay returns -1 for an absent day and bad input', () => {
  assert.equal(newestIndexForDay(AXIS, '2026-08-01'), -1);
  assert.equal(newestIndexForDay(AXIS, ''), -1);
  assert.equal(newestIndexForDay(null, '2026-07-30'), -1);
});

// ---------------------------------------------------------------------------
// formatModelTime — display only; must NOT alter the underlying ISO (no TZ shift).
// ---------------------------------------------------------------------------
test('formatModelTime formats by string surgery and echoes the ISO verbatim', () => {
  const f = formatModelTime('2026-07-30T00:00:00Z');
  assert.equal(f.date, '30 Jul 2026');
  assert.equal(f.time, '00:00');
  assert.equal(f.label, '00:00 UTC');
  assert.equal(f.iso, '2026-07-30T00:00:00Z');   // unchanged
});

test('formatModelTime preserves a non-midnight UTC time exactly', () => {
  const f = formatModelTime('2004-01-10T18:45:00Z');
  assert.equal(f.date, '10 Jan 2004');
  assert.equal(f.time, '18:45');
  assert.equal(f.label, '18:45 UTC');
  assert.equal(f.iso, '2004-01-10T18:45:00Z');
});

test('formatModelTime never mutates the axis and round-trips iso for every entry', () => {
  const snapshot = AXIS.slice();
  for (const iso of AXIS) {
    assert.equal(formatModelTime(iso).iso, iso);  // the real timestamp is preserved
  }
  assert.deepEqual(AXIS, snapshot);               // the axis array itself is untouched
});

test('formatModelTime degrades safely on malformed input (no throw, echoes input)', () => {
  const f = formatModelTime('not-a-timestamp');
  assert.equal(f.date, '—');
  assert.equal(f.iso, 'not-a-timestamp');
  const g = formatModelTime('');
  assert.equal(g.iso, '');
});

// ---------------------------------------------------------------------------
// isoFromLocalInput — datetime-local → canonical UTC ISO (or null → server default).
// ---------------------------------------------------------------------------
test('isoFromLocalInput normalises a datetime-local value to YYYY-MM-DDTHH:MM:00Z', () => {
  assert.equal(isoFromLocalInput('2026-07-30T14:30'), '2026-07-30T14:30:00Z');
});

test('isoFromLocalInput normalises seconds to :00 (drops any supplied seconds)', () => {
  assert.equal(isoFromLocalInput('2026-07-30T14:30:45'), '2026-07-30T14:30:00Z');
});

test('isoFromLocalInput returns null for empty/invalid so the caller omits the bound', () => {
  assert.equal(isoFromLocalInput(''), null);
  assert.equal(isoFromLocalInput(null), null);
  assert.equal(isoFromLocalInput(undefined), null);
  assert.equal(isoFromLocalInput('garbage'), null);
  assert.equal(isoFromLocalInput('2026-07-30'), null);   // date only, no time
});

// ---------------------------------------------------------------------------
// validateWindow — Argo From/To sanity (From must not be after To).
// ---------------------------------------------------------------------------
test('validateWindow accepts a well-ordered range', () => {
  assert.deepEqual(
    validateWindow('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
    { ok: true },
  );
});

test('validateWindow accepts equal bounds and any open (null) bound', () => {
  assert.equal(validateWindow('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z').ok, true);
  assert.equal(validateWindow(null, '2026-02-01T00:00:00Z').ok, true);
  assert.equal(validateWindow('2026-01-01T00:00:00Z', null).ok, true);
  assert.equal(validateWindow(null, null).ok, true);
});

test('validateWindow rejects From after To with an explicit error', () => {
  const r = validateWindow('2026-03-01T00:00:00Z', '2026-01-01T00:00:00Z');
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
});

// ---------------------------------------------------------------------------
// fieldCacheKey — stable, collision-free key over every byte-affecting parameter.
// ---------------------------------------------------------------------------
test('fieldCacheKey is stable for identical inputs', () => {
  const a = fieldCacheKey({ dataset: 'incois_argo_vam', variable: 'temp', depth: 0, time: AXIS[2], bbox: [60, 0, 100, 30] });
  const b = fieldCacheKey({ dataset: 'incois_argo_vam', variable: 'temp', depth: 0, time: AXIS[2], bbox: [60, 0, 100, 30] });
  assert.equal(a, b);
});

test('fieldCacheKey changes when ANY byte-affecting field changes', () => {
  const base = { dataset: 'd', variable: 'temp', depth: 0, time: AXIS[2], bbox: [1, 2, 3, 4] };
  const k = fieldCacheKey(base);
  assert.notEqual(k, fieldCacheKey({ ...base, variable: 'salt' }));
  assert.notEqual(k, fieldCacheKey({ ...base, depth: 10 }));
  assert.notEqual(k, fieldCacheKey({ ...base, time: AXIS[3] }));
  assert.notEqual(k, fieldCacheKey({ ...base, bbox: [1, 2, 3, 5] }));
  assert.notEqual(k, fieldCacheKey({ ...base, dataset: 'other' }));
});

test('fieldCacheKey serialises null depth and null bbox to empty segments (not "null")', () => {
  assert.equal(fieldCacheKey({ dataset: 'd', variable: 'temp', depth: null, time: 't', bbox: null }), 'd|temp||t|');
});

test('fieldCacheKey serialises an object bbox deterministically', () => {
  const k = fieldCacheKey({ dataset: 'd', variable: 'v', depth: 0, time: 't', bbox: { w: 1, e: 2 } });
  assert.ok(k.includes(JSON.stringify({ w: 1, e: 2 })));
});

// ---------------------------------------------------------------------------
// BoundedFieldCache — LRU eviction keeps memory flat; hits mark recency.
// ---------------------------------------------------------------------------
test('BoundedFieldCache stores and retrieves values', () => {
  const c = new BoundedFieldCache(3);
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  assert.equal(c.has('a'), true);
  assert.equal(c.size, 1);
  assert.equal(c.get('missing'), undefined);
});

test('BoundedFieldCache evicts the least-recently-used entry past its cap', () => {
  const c = new BoundedFieldCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);            // exceeds cap → 'a' (oldest) evicted
  assert.equal(c.size, 2);
  assert.equal(c.has('a'), false);
  assert.equal(c.has('b'), true);
  assert.equal(c.has('c'), true);
});

test('BoundedFieldCache: a get() refreshes recency so that entry survives eviction', () => {
  const c = new BoundedFieldCache(2);
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1);   // 'a' is now most-recently-used; 'b' is oldest
  c.set('c', 3);                 // evicts 'b', NOT 'a'
  assert.equal(c.has('a'), true);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('c'), true);
});

test('BoundedFieldCache: re-setting an existing key refreshes recency (no duplicate growth)', () => {
  const c = new BoundedFieldCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 11);          // refresh 'a' → 'b' becomes oldest
  assert.equal(c.size, 2);
  assert.equal(c.get('a'), 11);
  c.set('c', 3);           // evicts 'b'
  assert.equal(c.has('b'), false);
  assert.equal(c.has('a'), true);
});

test('BoundedFieldCache.clear empties the cache', () => {
  const c = new BoundedFieldCache(4);
  c.set('a', 1);
  c.set('b', 2);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.has('a'), false);
});

test('BoundedFieldCache works with real fieldCacheKey strings as keys', () => {
  const c = new BoundedFieldCache(8);
  const key = fieldCacheKey({ dataset: 'd', variable: 'temp', depth: 0, time: AXIS[2], bbox: [1, 2, 3, 4] });
  const field = { time: AXIS[2], values: [1, 2, 3] };
  c.set(key, field);
  assert.equal(c.get(key), field);                                   // same object back (zero-fetch re-render)
  assert.equal(c.get(fieldCacheKey({ dataset: 'd', variable: 'temp', depth: 0, time: AXIS[2], bbox: [1, 2, 3, 4] })), field); // rebuilt key hits
});
