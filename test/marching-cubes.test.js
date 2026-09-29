/**
 * Unit tests for the Phase 8 pure isosurface helpers (src/dataviz/MarchingCubes.js).
 *
 * Zero-install: only Node's built-in `node:test` + `node:assert/strict` — no
 * framework, no devDependency (safest for this no-VCS repo). Run with `npm test`
 * (which is `node --test`) or `node --test test/`.
 *
 * These cover the PURE-LOGIC guarantees the isosurface relies on (no DOM, no
 * network, no THREE):
 *   - a cell straddling the isovalue emits triangles at the correct crossing
 *     position (linear interpolation is exact);
 *   - shared edge vertices are de-duplicated into ONE indexed mesh;
 *   - a cell touching a MISSING corner (NaN / null) emits nothing — a real hole,
 *     never zero-filled or interpolated across;
 *   - an isovalue outside the data range yields an empty surface;
 *   - the extractor is deterministic (same input → identical output);
 *   - volumeExtent reports the REAL finite [min,max], excluding missing cells.
 * World-space mapping, disposal and regen-triggering are DOM/GPU-bound and are
 * covered by the manual browser tests instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { marchingCubes, volumeExtent } from '../src/dataviz/MarchingCubes.js';

// A single 2×2×2 cell with a linear ramp along x: value 0 at i=0, 10 at i=1
// (identical for every j,k). The surface {value = iso} is the plane x = iso/10.
function rampCube(lowVal = 0, highVal = 10) {
  const data = new Float64Array(8); // idx = i + 2*(j + 2*k)
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        data[i + 2 * (j + 2 * k)] = i === 0 ? lowVal : highVal;
      }
    }
  }
  return data;
}

test('cell straddling the isovalue emits the surface at the exact linear crossing', () => {
  const data = rampCube(0, 10);
  const { positions, indices, vertexCount, triangleCount } = marchingCubes({
    data, dims: [2, 2, 2], isovalue: 3, // crossing at x = 0.3
  });
  assert.ok(triangleCount >= 1, 'a straddling cell must emit triangles');
  assert.equal(vertexCount, 4, 'the planar crossing has four edge vertices');
  assert.equal(triangleCount, 2, 'four coplanar vertices → two triangles');
  // Every emitted vertex lies on the true crossing plane x = 0.3.
  for (let v = 0; v < positions.length; v += 3) {
    assert.ok(Math.abs(positions[v] - 0.3) < 1e-6, `x=${positions[v]} should be 0.3`);
    assert.ok(positions[v + 1] === 0 || positions[v + 1] === 1, 'y at a cell corner');
    assert.ok(positions[v + 2] === 0 || positions[v + 2] === 1, 'z at a cell corner');
  }
  // Indices reference the 4 shared vertices (dedup) — 2 tris × 3 = 6 slots.
  assert.equal(indices.length, 6);
  for (const idx of indices) assert.ok(idx >= 0 && idx < vertexCount);
});

test('crossing position tracks the isovalue (mu is a true value interpolation)', () => {
  const data = rampCube(0, 10);
  for (const iso of [1, 2.5, 7.5, 9]) {
    const { positions, vertexCount } = marchingCubes({ data, dims: [2, 2, 2], isovalue: iso });
    assert.equal(vertexCount, 4);
    for (let v = 0; v < positions.length; v += 3) {
      assert.ok(Math.abs(positions[v] - iso / 10) < 1e-6, `iso=${iso} → x=${iso / 10}`);
    }
  }
});

test('a cell touching a MISSING corner emits nothing (hole, never zero-filled)', () => {
  for (const missing of [NaN, null, undefined]) {
    const data = Array.from(rampCube(0, 10));  // plain array so it can hold null
    data[7] = missing;                          // corner (0,1,1) of the only cell
    const { vertexCount, triangleCount } = marchingCubes({ data, dims: [2, 2, 2], isovalue: 3 });
    assert.equal(vertexCount, 0, `missing=${String(missing)} must skip the cell`);
    assert.equal(triangleCount, 0);
  }
});

test('an isovalue outside the data range yields an empty surface', () => {
  const data = rampCube(0, 10);
  // Standard MC "inside = strictly below iso": a surface exists only for
  // iso ∈ (min, max]. So iso ≤ min (no corner strictly below) and iso > max
  // (every corner below) both give nothing — that is the out-of-range case.
  for (const iso of [-5, 0, 100]) {
    const { vertexCount, triangleCount } = marchingCubes({ data, dims: [2, 2, 2], isovalue: iso });
    assert.equal(triangleCount, 0, `iso=${iso} is outside (0,10] → no surface`);
    assert.equal(vertexCount, 0);
  }
});

test('degenerate grids and non-finite isovalues produce empty (never throw)', () => {
  const data = rampCube(0, 10);
  for (const dims of [[1, 2, 2], [2, 1, 2], [2, 2, 1]]) {
    const r = marchingCubes({ data, dims, isovalue: 3 });
    assert.equal(r.triangleCount, 0, `dims ${dims} cannot form a cell`);
  }
  const r = marchingCubes({ data, dims: [2, 2, 2], isovalue: NaN });
  assert.equal(r.triangleCount, 0);
});

test('extraction is deterministic (same input → byte-identical output)', () => {
  const data = rampCube(0, 10);
  const a = marchingCubes({ data, dims: [2, 2, 2], isovalue: 4 });
  const b = marchingCubes({ data, dims: [2, 2, 2], isovalue: 4 });
  assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
});

test('a larger volume with a mid-range isovalue produces a closed-ish shell', () => {
  // 3×3×3 field = distance-from-centre; contour at r=1 should emit a surface.
  const nx = 3, ny = 3, nz = 3;
  const data = new Float64Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const dx = i - 1, dy = j - 1, dz = k - 1;
    data[i + nx * (j + ny * k)] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const { vertexCount, triangleCount } = marchingCubes({ data, dims: [nx, ny, nz], isovalue: 1 });
  assert.ok(triangleCount > 0, 'a mid-range contour must produce triangles');
  assert.ok(vertexCount > 0);
});

test('volumeExtent returns the REAL finite [min,max] and excludes missing cells', () => {
  const values = [
    [[1, null], [2, 3]],
    [[4, 5], [-1, NaN]],
  ];
  const ext = volumeExtent(values);
  assert.deepEqual(ext, { min: -1, max: 5, count: 6 });
});

test('volumeExtent is null when there is no finite sample (never invents 0)', () => {
  assert.equal(volumeExtent([[[null, NaN], [undefined, null]]]), null);
  assert.equal(volumeExtent([]), null);
  assert.equal(volumeExtent(null), null);
});
