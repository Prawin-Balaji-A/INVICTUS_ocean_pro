// Deep-inspect a single GLB's animation/skin/morph structure so we can choose
// the correct optimization (InstancedMesh vs merge vs LOD) without breaking
// animation. Pure header parse. Usage: node scripts/glb-structure.mjs <relpath>
import fs from 'fs';
import path from 'path';

const rel = process.argv[2] || 'bed/corals2.glb';
const file = path.join(process.cwd(), 'src', 'assets', rel);

const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not GLB');
const chunkLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + chunkLen).toString('utf8'));

const nodes = json.nodes || [];
const meshes = json.meshes || [];
const skins = json.skins || [];
const anims = json.animations || [];

let skinnedMeshNodes = 0, meshNodesWithSkin = 0;
for (const n of nodes) {
  if (n.mesh !== undefined && n.skin !== undefined) meshNodesWithSkin++;
}
// meshes carrying JOINTS_0 (skinned geometry) vs morph targets
let skinnedGeo = 0, morphGeo = 0, plainGeo = 0;
for (const m of meshes) {
  let sk = false, mo = false;
  for (const p of (m.primitives || [])) {
    if (p.attributes && (p.attributes.JOINTS_0 !== undefined)) sk = true;
    if (p.targets && p.targets.length) mo = true;
  }
  if (sk) skinnedGeo++; else if (mo) morphGeo++; else plainGeo++;
}

// animation channel target-path histogram
const pathHist = {};
let totalChannels = 0;
for (const a of anims) {
  for (const c of (a.channels || [])) {
    const p = c.target && c.target.path ? c.target.path : '?';
    pathHist[p] = (pathHist[p] || 0) + 1;
    totalChannels++;
  }
}

// count distinct nodes targeted by animation
const animTargetNodes = new Set();
for (const a of anims) for (const c of (a.channels || [])) if (c.target && c.target.node !== undefined) animTargetNodes.add(c.target.node);

console.log(`FILE: ${rel}`);
console.log(`nodes=${nodes.length}  meshes=${meshes.length}  skins=${skins.length}  animations=${anims.length}`);
console.log(`mesh geometries: skinned(JOINTS_0)=${skinnedGeo}  morph=${morphGeo}  plain=${plainGeo}`);
console.log(`nodes that are (mesh + skin)=${meshNodesWithSkin}`);
if (skins.length) console.log(`skin joints: ${skins.map(s => (s.joints || []).length).join(', ')}`);
console.log(`animation channels=${totalChannels}  distinctTargetNodes=${animTargetNodes.size}`);
console.log(`channel target paths:`, JSON.stringify(pathHist));
console.log(`materials=${(json.materials||[]).length}  images=${(json.images||[]).length}  accessors=${(json.accessors||[]).length}`);
