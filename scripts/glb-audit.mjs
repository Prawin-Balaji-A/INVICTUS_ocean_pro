// DEV-ONLY headless GLB inspector. Reads each .glb JSON chunk and counts the
// declared images/textures/materials/meshes. No Three.js, no GPU — pure header
// parse — so it tells us the TRUE per-asset texture footprint independent of
// any runtime duplication. Run: node scripts/glb-audit.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'src', 'assets');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}

function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  // 12-byte header: magic, version, length
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('not a GLB');
  // First chunk
  const chunkLen = buf.readUInt32LE(12);
  const chunkType = buf.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = buf.slice(20, 20 + chunkLen).toString('utf8');
  return JSON.parse(json);
}

let totImages = 0, totTextures = 0, totMaterials = 0, totMeshes = 0, totPrims = 0;
const rows = [];
for (const file of walk(ROOT)) {
  try {
    const g = readGlbJson(file);
    const images = (g.images || []).length;
    const textures = (g.textures || []).length;
    const materials = (g.materials || []).length;
    const meshes = (g.meshes || []).length;
    const prims = (g.meshes || []).reduce((s, m) => s + (m.primitives ? m.primitives.length : 0), 0);
    const sizeMB = (fs.statSync(file).size / 1048576).toFixed(1);
    rows.push({ file: path.relative(ROOT, file), sizeMB, images, textures, materials, meshes, prims });
    totImages += images; totTextures += textures; totMaterials += materials; totMeshes += meshes; totPrims += prims;
  } catch (e) {
    rows.push({ file: path.relative(ROOT, file), err: e.message });
  }
}

rows.sort((a, b) => (b.textures || 0) - (a.textures || 0));
console.log('file'.padEnd(42), 'MB'.padStart(7), 'img'.padStart(5), 'tex'.padStart(5), 'mat'.padStart(5), 'mesh'.padStart(5), 'prim'.padStart(5));
for (const r of rows) {
  if (r.err) { console.log(r.file.padEnd(42), '  ERR', r.err); continue; }
  console.log(r.file.padEnd(42), String(r.sizeMB).padStart(7), String(r.images).padStart(5), String(r.textures).padStart(5), String(r.materials).padStart(5), String(r.meshes).padStart(5), String(r.prims).padStart(5));
}
console.log('-'.repeat(80));
console.log(`TOTALS across ${rows.length} files:  images=${totImages}  textures=${totTextures}  materials=${totMaterials}  meshes=${totMeshes}  primitives=${totPrims}`);
