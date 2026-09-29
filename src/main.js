import * as THREE from 'three';
import { HybridControls } from './HybridControls.js';
import GUI from 'lil-gui';
import { Radar } from './Radar.js';
import { EcosystemAI } from './ecosystem/EcosystemAI.js';
import { CreatureRegistry } from './creatures/CreatureRegistry.js';
import { CreatureLoader } from './creatures/CreatureLoader.js';
import { CoralManager } from './environment/CoralManager.js';
import { ShipwreckManager } from './environment/ShipwreckManager.js';
import { InstrumentManager } from './instruments/InstrumentManager.js';
import { ContainerShipManager } from './ship/ContainerShipManager.js';
import { OceanDataManager } from './ocean/OceanDataManager.js';
import { PFZEngine } from './simulation/PFZEngine.js';
import { DriftSimulationEngine } from './simulation/DriftSimulationEngine.js';
import { FeatureDetectionEngine } from './detection/FeatureDetectionEngine.js';
import { OceanCodex } from './education/OceanCodex.js';
import { UIManager } from './ui/UIManager.js';
import { UILayout } from './ui/UILayout.js';
import { Sky } from './Sky.js';
import { Ocean, OCEAN_CONFIG, MAX_FOAM_BODIES } from './Ocean.js';
import { Floor } from './Floor.js';
import { Island } from './Island.js';
import { Particles } from './Particles.js';
import { Post } from './Post.js';
import { FloatingBodies } from './FloatingBodies.js';
import { Clouds } from './Clouds.js';
import { OceanEnvironment } from './environment/OceanEnvironment.js';
import { PerformanceProfiler } from './performance/PerformanceProfiler.js';
// --- Ocean Data Visualization Platform (real-data core) ---
import { OceanDataService } from './dataviz/OceanDataService.js';
import { GeoTransform } from './dataviz/GeoTransform.js';
import { ObservationLayer } from './dataviz/ObservationLayer.js';
import { ObservationProfileViewer } from './dataviz/ObservationProfileViewer.js';
import { ModelFieldLayer } from './dataviz/ModelFieldLayer.js';
import { IsosurfaceLayer } from './dataviz/IsosurfaceLayer.js';
import { DataVizPanel } from './dataviz/DataVizPanel.js';
import { GeoInset } from './dataviz/GeoInset.js';
import { regionNameUpper } from './geo/OceanRegions.js';
// --- 3D Earth globe entry point (Mode 1) — flows into the ocean core above ---
import { GlobeView } from './globe/GlobeView.js';
import { GlobeControls } from './globe/GlobeControls.js';
import { selectedLocation } from './dataviz/SelectedLocation.js';
// ---------------------------------------------------------------------------
//  Boot
// ---------------------------------------------------------------------------
const container = document.getElementById('app');
const bootEl = document.getElementById('boot');
const oceanBootEl = document.getElementById('ocean-boot');
const oceanBootRegionEl = document.getElementById('ocean-boot-region');
const hintEl = document.getElementById('hint');
const depthEl = document.getElementById('depth');
const depthStateEl = document.getElementById('depth-state');
const depthValEl = document.getElementById('depth-val');

const sizeW = () => window.innerWidth;
const sizeH = () => window.innerHeight;

// Surface any runtime/GPU error onto the boot screen instead of hanging on it.
function showFatal(msg) {
  const small = bootEl && bootEl.querySelector('small');
  if (small) small.textContent = String(msg).slice(0, 220);
  const h1 = bootEl && bootEl.querySelector('h1');
  if (h1) h1.textContent = 'Error';
  if (bootEl) bootEl.classList.remove('hidden');
}
window.addEventListener('error', (e) => showFatal(e.message || e.error));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

// ---------------------------------------------------------------------------
//  Renderer  (linear HDR pipeline — tone-mapping happens in the post composite)
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(sizeW(), sizeH());
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = true;
container.appendChild(renderer.domElement);

// Report GLSL compile/link errors to the boot overlay + console.
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (s, label) => {
    const info = gl.getShaderInfoLog(s) || '';
    if (info.trim()) console.error(`[${label}] ${info}`);
    return info;
  };
  const v = log(vs, 'vertex');
  const f = log(fs, 'fragment');
  showFatal('Shader error — see console. ' + (f || v));
};

// ---------------------------------------------------------------------------
//  Sun / time of day
// ---------------------------------------------------------------------------
const sunParams = { elevation: 22, azimuth: 108 };
const sunDir = new THREE.Vector3();
function updateSunDir() {
  const el = THREE.MathUtils.degToRad(sunParams.elevation);
  const az = THREE.MathUtils.degToRad(sunParams.azimuth);
  const h = Math.cos(el);
  sunDir.set(Math.cos(az) * h, Math.sin(el), Math.sin(az) * h).normalize();
}
updateSunDir();

// ---------------------------------------------------------------------------
//  Scene & Camera
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, sizeW() / sizeH(), 0.1, 8000);
camera.position.set(0, 14, 48);

// Submarine spotlight - camera-attached headlight that follows camera heading
const submarineLight = new THREE.SpotLight(0xffffff, 0); // Intensity 0 above water
// Small forward/down "eye" offset in LOCAL camera space only (Option A: fully
// parented, no world-space writes -> no double-transform / beam drift).
submarineLight.position.set(0, -0.4, -1.2);
submarineLight.angle = Math.PI / 5; // Wide-but-focused cone
submarineLight.penumbra = 0.5; // Soft edges
submarineLight.decay = 1.1; // Gentler falloff -> meaningful underwater range
submarineLight.distance = 320; // Extended range
submarineLight.castShadow = false;
submarineLight.color.setHex(0xd4f0ff); // Cool underwater white/cyan tint

// Physically-scaled headlight intensity (candela; the SpotLight uses r155+
// physical distance attenuation with decay 1.1). This is the ONLY light that
// brightens organisms underwater. It was previously 2200, which pushed the
// reflected radiance of lit surfaces far above 1.0 at real working distances,
// so the bright-pass bloom then wrapped every torch-lit creature/coral/wreck in
// a glowing halo (the reported "glow"). ~130 gives a natural forward pool that
// still lights the seabed strongly without blowing lit surfaces past the bloom
// threshold. Live-tunable via the "Torch" GUI folder and OCEAN.setTorchIntensity.
const torchCfg = { intensity: 130 };

// Dynamic target that follows camera heading - NO fixed world position
const lightTargetDistance = 100;
const _torchPos = new THREE.Vector3();
const _torchTarget = new THREE.Vector3();
const _torchDir = new THREE.Vector3();
camera.add(submarineLight);
camera.add(submarineLight.target);
// Target is parented to the camera and sits directly ahead (camera looks down local -Z),
// so the beam follows camera heading every frame with no per-frame world-space math.
submarineLight.target.position.set(0, 0, -lightTargetDistance);
scene.add(camera);

const controls = new HybridControls(camera, renderer.domElement);

const FLOOR_DEPTH = 150;
const oceanEnv = new OceanEnvironment(0, FLOOR_DEPTH);

const sky = new Sky(sunDir);
scene.add(sky.mesh);

const ocean = new Ocean(sunDir, new THREE.Vector2(sizeW(), sizeH()));
ocean.uniforms.uNear.value = camera.near;
ocean.uniforms.uFar.value = camera.far;
scene.add(ocean.mesh);

const floor = new Floor(sunDir, FLOOR_DEPTH);
scene.add(floor.mesh);

// Subsystems
const ecosystemAI = new EcosystemAI(oceanEnv);
ecosystemAI.enabled = true;
ecosystemAI.debug = false;
window.ecosystemAI = ecosystemAI;

const creatureRegistry = new CreatureRegistry();
const creatures = []; // shared array for creatures
const creatureLoader = new CreatureLoader(scene, camera, ecosystemAI, creatureRegistry, oceanEnv);

const coralManager = new CoralManager(scene, floor);

const shipwreckManager = new ShipwreckManager(scene, floor);

const instrumentManager = new InstrumentManager(scene);

// Container ship — a moving SIMULATION/visualisation surface vessel (not observation
// data). Radar-only; deliberately kept out of the Codex species path. Built during the
// deferred ocean build and fed the live entity registry each frame for avoidance.
const shipManager = new ContainerShipManager(scene);

// ---------------------------------------------------------------------------
//  Deferred ocean build (Earth-first startup). The heavy asset loads — creature
//  GLBs (up to ~99 MB), corals, the shipwreck, and the instrument fleet — are the
//  real page weight. Running them at module load made the boot splash linger in
//  front of the globe. GlobeView owns its OWN scene, so the globe renders
//  immediately; these loads are deferred to the FIRST dive (then continue in the
//  background exactly as before) behind the "Preparing…" overlay. Idempotent: the
//  first dive builds, every later dive is instant. No data is fabricated or moved —
//  only WHEN these existing loaders run changes.
// ---------------------------------------------------------------------------
const _delay = (ms) => new Promise((r) => setTimeout(r, ms));
let _oceanBuildPromise = null;
function ensureOceanBuilt() {
  if (_oceanBuildPromise) return _oceanBuildPromise;
  _oceanBuildPromise = (async () => {
    let priority;
    try { priority = creatureLoader.loadAll(creatures); } catch (e) { console.warn('[ocean-build] creatures:', e); }
    try { coralManager.load(); } catch (e) { console.warn('[ocean-build] corals:', e); }
    try { shipwreckManager.load(); } catch (e) { console.warn('[ocean-build] shipwreck:', e); }
    try { instrumentManager.init(ocean); } catch (e) { console.warn('[ocean-build] instruments:', e); }
    try { shipManager.load(ocean); } catch (e) { console.warn('[ocean-build] ship:', e); }
    // Let the priority creature wave arrive so the first dive isn't into an empty
    // sea, but NEVER block on the full background load; hold a short minimum so the
    // transition reads intentionally instead of flashing.
    try {
      await Promise.all([
        _delay(450),
        Promise.race([Promise.resolve(priority), _delay(4000)]),
      ]);
    } catch (_) { /* build failures already logged; still reveal the ocean */ }
  })();
  return _oceanBuildPromise;
}

window.getSceneObjects = () => {
  const list = [];
  scene.traverse(obj => {
    if (obj.isMesh && obj !== sky.mesh && obj !== ocean.mesh && obj !== floor.mesh) {
      const box = new THREE.Box3().setFromObject(obj);
      list.push({
        name: obj.name,
        parent: obj.parent?.name,
        grand: obj.parent?.parent?.name,
        box: { minY: box.min.y, maxY: box.max.y, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
        height: box.max.y - box.min.y,
        width: box.max.x - box.min.x
      });
    }
  });
  return list;
};


window.raycastCenter = (screenX = 0, screenY = 0) => {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(screenX, screenY), camera);
  const hits = rc.intersectObjects(scene.children, true);
  return hits.filter(h => h.object !== sky.mesh && h.object !== ocean.mesh && h.object !== floor.mesh).map(h => ({
    name: h.object.name,
    parent: h.object.parent?.name,
    grand: h.object.parent?.parent?.name,
    dist: h.distance,
    point: h.point
  }));
};

const oceanData = new OceanDataManager();
const pfzEngine = new PFZEngine(scene, oceanData);
const driftSimulation = new DriftSimulationEngine(scene, oceanData);
const featureDetection = new FeatureDetectionEngine(scene, oceanData);

// ---------------------------------------------------------------------------
//  Ocean Data Visualization — REAL observations (INCOIS ERDDAP Argo).
//  Format-agnostic path: OceanDataService → canonical schema → 3D markers +
//  depth profile. Unlike the demo engines above, NO scientific values are
//  synthesized here; failures surface as explicit errors in the panel.
// ---------------------------------------------------------------------------
const geoTransform = new GeoTransform();
const observationLayer = new ObservationLayer(scene, geoTransform);
// Phase 5 — real gridded model/analysis field rendered as a depth slice. Shares
// the SAME GeoTransform as the observation markers so the slice is aligned with
// the floats and the rest of the scene. Rendering only; data comes from the
// Phase 4 backend via OceanDataService.
const modelFieldLayer = new ModelFieldLayer(scene, geoTransform);
// Phase 8 — real 3-D isosurface. An ADDITIONAL layer sharing the SAME scene and
// GeoTransform as the depth slice and Argo markers, so its extracted surface is
// aligned with everything else. Rendering only; the real depth-resolved volume
// comes from the same backend via OceanDataService.getModelVolume.
const isosurfaceLayer = new IsosurfaceLayer(scene, geoTransform);
const profileViewer = new ObservationProfileViewer();
const oceanDataService = new OceanDataService();

function focusCameraOnData(worldPos) {
  // Gentle framing: stand off from the marker and aim the heading at it.
  // HybridControls rebuilds the camera quaternion from heading + look offsets
  // every frame, so we set heading (+ a downward pitch) and clear the offsets.
  camera.position.set(worldPos.x + 40, worldPos.y + 30, worldPos.z + 60);
  const dx = worldPos.x - camera.position.x;
  const dz = worldPos.z - camera.position.z;
  controls.heading = Math.atan2(-dx, -dz);
  controls.lookYawOffset = 0;
  controls.lookPitch = Math.atan2(worldPos.y - camera.position.y, Math.hypot(dx, dz));
}

// Bottom-right top-down geographic inset — shows, from REAL inputs only, where the
// selection and the loaded field sit on Earth (graticule, queried region bbox, the
// rendered field footprint, and the selected-location marker). Hidden on the globe.
const geoInset = new GeoInset();

const dataVizPanel = new DataVizPanel({
  service: oceanDataService,
  layer: observationLayer,
  viewer: profileViewer,
  geoTransform,
  modelLayer: modelFieldLayer,   // Phase 5 gridded depth-slice layer
  isoLayer: isosurfaceLayer,     // Phase 8 real 3-D isosurface layer (additional)
  onFocus: focusCameraOnData,
  onFieldRender: (field) => {
    // Reuse the EXACT real field the 3D slice just rendered — the same lat/lon/
    // values arrays and the same ScientificColorScale object — as a 2D raster in
    // the geo inset. No refetch, no second dataset, no second colour scale. The
    // inset also derives the footprint outline from these same axes.
    if (field && field.latitude && field.longitude && field.values) {
      geoInset.setFieldGrid({ ...field, colorScale: modelFieldLayer.colorScale });
    } else {
      geoInset.clearField();
    }
  },
  // A purely-visual recolour (palette / min / max / linear-log) mutates
  // modelFieldLayer's colorScale IN PLACE and fires no field fetch. Redraw the
  // inset so its raster tracks the 3D slice's colours locally — zero network.
  onFieldRecolor: () => geoInset.redraw(),
  deferStart: true,   // dormant until the user enters the ocean from the globe
});

// ---------------------------------------------------------------------------
//  MODE 1 — 3D Earth globe entry point (flows INTO the ocean core above).
//  Boot starts on the globe; a click captures a REAL lat/lon from sphere-
//  intersection math (GlobeView.pickAt), then "Explore Ocean" transitions into
//  the EXISTING ocean, centred on the location, seeding the real INCOIS Argo
//  region query. animate() simply bypasses the ocean pipeline while in globe mode.
// ---------------------------------------------------------------------------
let mode = 'globe';   // 'globe' | 'ocean' — read by animate() and the click handler

// The globe writes the shared SelectedLocation on every pick; that observable is
// the single geographic hand-off between globe (globe↔lat/lon) and ocean
// (lat/lon↔world). No coordinate logic is duplicated across the two spaces.
const globeView = new GlobeView(renderer, {
  onPick: (loc) => selectedLocation.set({ ...loc, source: 'globe' }),
});
const globeControls = new GlobeControls();
globeControls.setAssetMissing(
  globeView.assetMissing,
  globeView.assetMissing
    ? 'No Earth image in src/assets/earth/ — showing a neutral placeholder. Picking still returns real lat/lon.'
    : ''
);

// Subtle procedural marker for the selected location in the ocean (primitive
// geometry — allowed, like the ObservationLayer halo). Sits at the point's
// ocean-world position (≈ origin once the region is re-centred on it).
const PIN_CYAN = 0x4fe3ff;   // selection cyan — matches the globe pin + ObservationLayer highlight
const oceanMarker = (() => {
  const group = new THREE.Group();
  group.visible = false;
  const spike = new THREE.Mesh(
    new THREE.ConeGeometry(3, 12, 20),
    new THREE.MeshBasicMaterial({ color: PIN_CYAN, transparent: true, opacity: 0.9 })
  );
  spike.rotation.x = Math.PI;   // apex points down toward the surface point
  spike.position.y = 10;        // tip near the float surface plane (~Y=4)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(6, 0.4, 8, 40),
    new THREE.MeshBasicMaterial({ color: PIN_CYAN, transparent: true, opacity: 0.6 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.5;
  group.add(spike, ring);
  scene.add(group);
  return {
    showAt(p) { group.position.set(p.x, 0, p.z); group.visible = true; },
    hide() { group.visible = false; },
  };
})();

// Dive-transition overlay ("Preparing <REGION>…"). Shown while the first dive
// builds the heavy ocean scene; the region line is the REAL sea name (or a neutral
// fallback when the point matches no named polygon) — never invented.
function showOceanBoot(region) {
  if (oceanBootRegionEl) oceanBootRegionEl.textContent = region ? `Preparing ${region}` : 'Preparing ocean';
  if (oceanBootEl) oceanBootEl.classList.add('show');
}
function hideOceanBoot() {
  if (oceanBootEl) oceanBootEl.classList.remove('show');
}

// Flow INTO the existing ocean, centred on the selected location. On the FIRST dive
// this awaits the deferred heavy build behind the "Preparing…" overlay; later dives
// find it already built and proceed immediately (instant re-dive).
async function enterOcean() {
  const loc = selectedLocation.get();
  if (!loc) return;
  // Authoritative sea/ocean name for the point (real point-in-polygon). May be null
  // over an unnamed gap — then we show coordinates alone, never a made-up name.
  const region = regionNameUpper(loc.longitude, loc.latitude);
  showOceanBoot(region);
  await ensureOceanBuilt();
  mode = 'ocean';
  document.body.classList.remove('globe-mode');
  globeView.setEnabled(false);
  controls.enabled = true;                    // HybridControls active again
  globeControls.setMode('ocean');
  // Centre the region on the point and load real INCOIS Argo. This sets geo
  // bounds synchronously, so the point maps to ~world origin just below. The
  // returned region is EXACTLY what was sent to the backend — display that so
  // the badge's region can never silently differ from the query.
  const sentRegion = dataVizPanel.applySelectedLocation(loc);
  globeControls.showLocation(loc, sentRegion);
  globeControls.setOceanRegionName(region);   // prominent authoritative sea name
  geoInset.setLocation(loc);
  geoInset.setBbox(sentRegion);
  geoInset.setRegion(region);
  const p = geoTransform.lonLatToWorld(loc.longitude, loc.latitude, 0);
  oceanMarker.showAt(p);
  focusCameraOnData(p);
  // [OCEAN DEBUG] One-shot dive trace (regression diagnosis; not per-frame). Shows
  // whether the ocean actually became the active mode + where the camera ended up.
  // If the globe stays on screen while the radar moves, watch for [OceanScene] /
  // [OceanRender] errors below — those name the exact throw that froze the canvas.
  if (!enterOcean._traced) {
    enterOcean._traced = true;
    const shipOk = !!(shipManager.getEntity && shipManager.getEntity());
    console.log('[OCEAN DEBUG]',
      '\n  mode AFTER      =', mode,
      '\n  selected lat/lon=', loc.latitude, loc.longitude,
      '\n  scene.children  =', scene.children.length,
      '\n  creatures       =', creatures.length,
      '\n  ship exists     =', shipOk,
      '\n  camera pos      =', camera.position.x.toFixed(1), camera.position.y.toFixed(1), camera.position.z.toFixed(1),
      '\n  globe orbit on  =', globeView.controls.enabled);
  }
  // Reveal only after the ocean has drawn a frame (covers the one-time lazy shader
  // compile on the first dive) so there is no black/half-built flash.
  requestAnimationFrame(() => requestAnimationFrame(hideOceanBoot));
}

// Return to the globe; the selection is preserved until another is picked.
function enterGlobe() {
  mode = 'globe';
  document.body.classList.add('globe-mode');
  globeView.setEnabled(true);
  controls.enabled = false;                   // HybridControls inert on the globe
  globeControls.setMode('globe');
  const loc = selectedLocation.get();
  if (loc) globeView.setPin(loc.latitude, loc.longitude);
}

globeControls.onExplore(enterOcean);
globeControls.onReturn(enterGlobe);

// Keep the HUD/badge and the globe pin in sync with the current selection. The
// globe previews the region-to-be (same formula the ocean query uses), so the
// user sees the exact point AND region before committing to Explore.
selectedLocation.subscribe((loc) => {
  const bbox = loc ? DataVizPanel.regionFor(loc) : null;
  const region = loc ? regionNameUpper(loc.longitude, loc.latitude) : null;
  globeControls.showLocation(loc, bbox);
  globeControls.setOceanRegionName(region);   // preview the real sea name before diving
  geoInset.setLocation(loc);
  geoInset.setBbox(bbox);
  geoInset.setRegion(region);
  if (mode === 'globe' && loc) globeView.setPin(loc.latitude, loc.longitude);
});

// Click handling: on the globe, pick a location (ignoring orbit drags); in the
// ocean, keep the existing marker→profile behaviour. The mouse is always free
// (HybridControls is keyboard-only), so neither fights navigation.
let _downX = 0, _downY = 0;
renderer.domElement.addEventListener('pointerdown', (ev) => { _downX = ev.clientX; _downY = ev.clientY; });
renderer.domElement.addEventListener('click', (ev) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1
  );
  if (mode === 'globe') {
    if (Math.hypot(ev.clientX - _downX, ev.clientY - _downY) > 6) return; // was an orbit drag
    // §1: only REAL ocean is selectable. pickAt classifies the hit against the
    // Earth image; land clicks return terrain:'land' WITHOUT selecting, so we
    // just prompt for an ocean and stay on the globe. Ocean (or 'unknown' when
    // no Earth pixels are available) selects via onPick inside pickAt.
    const picked = globeView.pickAt(ndc);
    if (picked && picked.terrain === 'land') {
      globeControls.setHint('Please click an ocean area to explore.');
    } else if (picked) {
      globeControls.setHint('');
    }
    return;
  }
  if (!observationLayer.visible) return;
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hit = observationLayer.raycast(rc);
  if (hit) dataVizPanel.selectByIndex(hit.index);
});

// Boot on the globe: hide ocean chrome, park HybridControls, enable orbit.
document.body.classList.add('globe-mode');
controls.enabled = false;
globeView.setEnabled(true);
globeControls.setMode('globe');

window.OCEAN_DATA = { service: oceanDataService, layer: observationLayer, geo: geoTransform, panel: dataVizPanel, viewer: profileViewer, location: selectedLocation };
window.GLOBE = { view: globeView, controls: globeControls, enterOcean, enterGlobe, get mode() { return mode; } };

const codex = new OceanCodex(camera);
const uiManager = new UIManager();
uiManager.setCodexInstance(codex);

// §2/§9: give the fixed-position HUD chrome a real layout instead of stacking it
// all in the top-left corner. UILayout seats the depth meter, Ocean Data launcher
// and panel in a measured top-left lane (depth meter never hidden), keeps the
// location badge clear of the right-side toolbar, and logs an overlap check. It
// re-runs itself on resize / mode switch / panel open+close via its observers.
const uiLayout = new UILayout();
uiLayout.register(['depth', 'dv-launch', 'dv-panel', 'ocean-loc-badge', 'sim-toolbar']);
window.UILAYOUT = uiLayout;   // console handle: UILAYOUT.validate() re-runs the overlap check

// Wire Codex discoveries & target focus card
codex.onDiscovery((entry, totalCount) => {
  uiManager.showDiscovery(entry, totalCount);
});
codex.onTargetFocus((profile, entity, dist) => {
  uiManager.showFocusCard(profile, entity, dist);
});
codex.onTargetBlur(() => {
  // Focus card is persistent: camera-distance blur does NOT auto-hide the card.
  // The card remains visible until the user closes it (X / Esc) or focuses another entity.
});

// Wire Simulation Toolbar Buttons
document.getElementById('btn-pfz')?.addEventListener('click', (e) => {
  const btn = e.target;
  const isVis = !pfzEngine.visible;
  pfzEngine.setVisible(isVis);
  btn.classList.toggle('active', isVis);
  if (isVis) pfzEngine.computePFZ();
});

document.getElementById('btn-sar')?.addEventListener('click', (e) => {
  const btn = e.target;
  const isVis = !driftSimulation.visible;
  driftSimulation.setVisible(isVis);
  btn.classList.toggle('active', isVis);
  if (isVis) driftSimulation.simulateDrift(new THREE.Vector3(camera.position.x, -5, camera.position.z), 24);
});

document.getElementById('btn-features')?.addEventListener('click', (e) => {
  const btn = e.target;
  const isVis = !featureDetection.visible;
  featureDetection.setVisible(isVis);
  btn.classList.toggle('active', isVis);
});

const radar = new Radar({ detectionRadius: 150 });

const island = new Island(sunDir, FLOOR_DEPTH, ocean.uniforms);
// scene.add(island.mesh); // Removed island rendering

const particles = new Particles(5000, 160);
scene.add(particles.points);

// Lights — only the dropped primitives (MeshStandardMaterial) use these; the
// ocean/island/sky are raw ShaderMaterials and ignore scene lights.
const sunLight = new THREE.DirectionalLight(0xfff2e0, 3.0);
scene.add(sunLight, sunLight.target);
const skyLight = new THREE.HemisphereLight(0xbfe4ff, 0x24424e, 1.1);
scene.add(skyLight);

const underwaterAmbient = new THREE.AmbientLight(0x336688, 0.0);
scene.add(underwaterAmbient);

// Subtle underwater fill light — simulates scattered surface illumination
const underwaterFill = new THREE.DirectionalLight(0x4488aa, 0.0);
underwaterFill.position.set(0, 1, 0); // from above
scene.add(underwaterFill);

// Dropped, buoyant primitives (spheres / cubes).
const bodies = new FloatingBodies(scene);
const terrainAt = (x, z) => island.heightAt(x, z);

function dropObject(type, x, z) {
  bodies.spawn(type, x, z, ocean.heightAt(x, z, time));
}
function dropAtTarget(type) {
  const t = controls.target;
  dropObject(type, t.x + (Math.random() - 0.5) * 10, t.z + (Math.random() - 0.5) * 10);
}

// ---------------------------------------------------------------------------
//  Render targets  (full-res, half-float, with depth textures)
// ---------------------------------------------------------------------------
function makeSceneRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  rt.depthTexture = new THREE.DepthTexture(w, h);
  rt.depthTexture.type = THREE.UnsignedIntType;
  return rt;
}
let refractionRT = makeSceneRT(sizeW(), sizeH());
let hdrRT = makeSceneRT(sizeW(), sizeH());

ocean.uniforms.uRefractionTex.value = refractionRT.texture;
ocean.uniforms.uDepthTex.value = refractionRT.depthTexture;

const post = new Post(renderer, sizeW(), sizeH(), sunDir, OCEAN_CONFIG.deepColor);

// Volumetric sky clouds (on by default; half-res + temporal reprojection keeps
// them cheap). When on, the flat procedural clouds in the atmosphere fade back
// so the sky isn't doubled, and they cast moving shadows on the sea.
const clouds = new Clouds(renderer, sizeW(), sizeH(), { scale: 0.5 });
const cloudShadowP = { strength: 0.5 };
function setCloudsEnabled(on) {
  clouds.enabled = on;
  const cover = on ? 0.25 : 1.0;
  sky.uniforms.uCloudCover.value = cover;
  ocean.uniforms.uCloudCover.value = cover;
  if (!on) ocean.uniforms.uCloudShadow.value = 0;
}

// ---------------------------------------------------------------------------
//  Sun propagation
// ---------------------------------------------------------------------------
function applySun() {
  updateSunDir();
  sky.setSun(sunDir);
  ocean.setSun(sunDir);
  floor.setSun(sunDir);
  island.setSun(sunDir);
  post.underwaterMat.uniforms.uSunDir.value.copy(sunDir);
  clouds.setSun(sunDir);
  // Point the primitives' key light along the sun; warmer & dimmer near sunset.
  sunLight.position.copy(sunDir).multiplyScalar(300);
  sunLight.target.position.set(0, 0, 0);
  sunLight.intensity = 0.6 + 3.0 * Math.max(sunDir.y, 0.0);
}

// ---------------------------------------------------------------------------
//  Cinematic presets — curated sun + water + wave + post looks.
// ---------------------------------------------------------------------------
const PRESETS = {
  'Tropical Noon': {
    sun: { el: 60, az: 125 }, amplitude: 0.7, choppy: 0.5, speed: 1.0, waveCount: 26,
    exposure: 1.05, bloom: 0.5, clarity: 1.3, depthFalloff: 0.16, sunGlitter: 0, sss: 0.35,
    deep: '#063049', shallow: '#5fc6c2', foam: '#f6fdff', foamCoverage: 0.9, crestFoamStart: 1.4,
    fog: 1.0, shafts: 0.05,
    roughness: 0.06, cloudCoverage: 0.34, saturation: 1.08,
  },
  'Golden Hour': {
    sun: { el: 8, az: 205 }, amplitude: 0.9, choppy: 0.6, speed: 0.9, waveCount: 26,
    exposure: 1.15, bloom: 0.95, clarity: 1.0, depthFalloff: 0.18, sunGlitter: 0.55, sss: 0.55,
    deep: '#08283b', shallow: '#3f9f9a', foam: '#fff1df', foamCoverage: 0.85, crestFoamStart: 1.5,
    fog: 1.0, shafts: 0.06,
    roughness: 0.09, cloudCoverage: 0.45, saturation: 1.1,
  },
  'Crimson Sunset': {
    sun: { el: 1.5, az: 250 }, amplitude: 1.0, choppy: 0.7, speed: 0.95, waveCount: 24,
    exposure: 1.2, bloom: 1.15, clarity: 0.9, depthFalloff: 0.2, sunGlitter: 0.6, sss: 0.5,
    deep: '#0e1524', shallow: '#33707a', foam: '#ffe4cf', foamCoverage: 0.9, crestFoamStart: 1.4,
    fog: 1.1, shafts: 0.05,
    roughness: 0.11, cloudCoverage: 0.52, saturation: 1.12,
  },
  'Blue Hour': {
    sun: { el: 2.5, az: 292 }, amplitude: 0.6, choppy: 0.5, speed: 0.8, waveCount: 24,
    exposure: 0.9, bloom: 0.6, clarity: 1.0, depthFalloff: 0.2, sunGlitter: 0.4, sss: 0.3,
    deep: '#050f1e', shallow: '#295a72', foam: '#dbe8f2', foamCoverage: 0.9, crestFoamStart: 1.5,
    fog: 1.1, shafts: 0.04,
    roughness: 0.08, cloudCoverage: 0.42, saturation: 1.0,
  },
  'Clear Dawn': {
    sun: { el: 14, az: 95 }, amplitude: 0.55, choppy: 0.45, speed: 0.85, waveCount: 26,
    exposure: 1.05, bloom: 0.7, clarity: 1.4, depthFalloff: 0.15, sunGlitter: 0.45, sss: 0.4,
    deep: '#073246', shallow: '#63c7c0', foam: '#eefaff', foamCoverage: 0.85, crestFoamStart: 1.6,
    fog: 1.0, shafts: 0.06,
    roughness: 0.06, cloudCoverage: 0.28, saturation: 1.06,
  },
  'Stormy Seas': {
    sun: { el: 18, az: 100 }, amplitude: 1.8, choppy: 1.05, speed: 1.6, waveCount: 32,
    exposure: 0.95, bloom: 0.4, clarity: 0.7, depthFalloff: 0.22, sunGlitter: 0.2, sss: 0.25,
    deep: '#0a1a20', shallow: '#38666a', foam: '#eef3f5', foamCoverage: 1.05, crestFoamStart: 1.3,
    fog: 1.35, shafts: 0.05,
    roughness: 0.22, cloudCoverage: 0.7, cloudDensity: 1.5, saturation: 0.92,
  },
};

function applyPreset(name) {
  const P = PRESETS[name];
  if (!P) return;
  const u = ocean.uniforms;
  if (P.sun) { sunParams.elevation = P.sun.el; sunParams.azimuth = P.sun.az; }
  const set = (k, v) => { if (v !== undefined) u[k].value = v; };
  set('uAmplitude', P.amplitude); set('uChoppy', P.choppy); set('uSpeed', P.speed);
  set('uWaveCount', P.waveCount); set('uClarity', P.clarity); set('uDepthFalloff', P.depthFalloff);
  set('uSunGlitter', P.sunGlitter); set('uSSSStrength', P.sss); set('uRoughness', P.roughness);
  set('uFoamCoverage', P.foamCoverage); set('uCrestFoamStart', P.crestFoamStart);
  if (P.deep) u.uDeepColor.value.set(P.deep);
  if (P.shallow) u.uShallowColor.value.set(P.shallow);
  if (P.foam) u.uFoamColor.value.set(P.foam);
  if (P.exposure !== undefined) post.compositeMat.uniforms.uExposure.value = P.exposure;
  if (P.bloom !== undefined) post.compositeMat.uniforms.uBloom.value = P.bloom;
  if (P.saturation !== undefined) post.compositeMat.uniforms.uSaturation.value = P.saturation;
  if (P.fog !== undefined) post.underwaterMat.uniforms.uFogStrength.value = P.fog;
  if (P.shafts !== undefined) post.underwaterMat.uniforms.uShaftDensity.value = P.shafts;
  if (P.cloudCoverage !== undefined) clouds.uniforms.uCoverage.value = P.cloudCoverage;
  if (P.cloudDensity !== undefined) clouds.uniforms.uDensity.value = P.cloudDensity;
  applySun();
  presetProxy.preset = name;   // keep the dropdown in sync (incl. programmatic calls)
  refreshColorCtrls();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

// ---------------------------------------------------------------------------
//  GUI
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'Ocean' });

const colorCtrls = [];
function refreshColorCtrls() {
  for (const cc of colorCtrls) {
    cc.proxy.c = '#' + cc.uniform.value.getHexString();
    cc.ctrl.updateDisplay();
  }
}

const fPre = gui.addFolder('Cinematic').close();
const presetProxy = { preset: 'Tropical Noon' };
fPre.add(presetProxy, 'preset', Object.keys(PRESETS)).name('preset').onChange(applyPreset);
fPre.add({ cinema: false }, 'cinema').name('cinematic camera')
  .onChange((v) => (controls.autoRotate = v));

const fSun = gui.addFolder('Time of day').close();
fSun.add(sunParams, 'elevation', -3, 89, 0.5).name('sun elevation').onChange(applySun);
fSun.add(sunParams, 'azimuth', 0, 360, 1).name('sun azimuth').onChange(applySun);

const fWaves = gui.addFolder('Waves').close().hide();
fWaves.add(ocean.uniforms.uAmplitude, 'value', 0.1, 3.5, 0.05).name('amplitude');
fWaves.add(ocean.uniforms.uChoppy, 'value', 0.0, 1.4, 0.02).name('choppiness');
fWaves.add(ocean.uniforms.uWaveCount, 'value', 4, 40, 1).name('wave count');
fWaves.add(ocean.uniforms.uSpeed, 'value', 0.0, 3.0, 0.05).name('speed');
fWaves.add(ocean.uniforms.uDirSpread, 'value', 0.0, 1.6, 0.02).name('direction spread');
fWaves
  .add({ wl: OCEAN_CONFIG.baseWavelength }, 'wl', 40, 320, 5)
  .name('swell length')
  .onChange((v) => (ocean.uniforms.uBaseFreq.value = (2 * Math.PI) / v));

// lil-gui colour control bound to a THREE.Color uniform (sRGB picker ⇄ linear).
function addColorCtrl(folder, uniform, name) {
  const proxy = { c: '#' + uniform.value.getHexString() };
  const ctrl = folder.addColor(proxy, 'c').name(name).onChange((v) => uniform.value.set(v));
  colorCtrls.push({ ctrl, proxy, uniform });
}

const fSurf = gui.addFolder('Surface').close().hide();
fSurf.add(ocean.uniforms.uDetailStrength, 'value', 0.0, 1.2, 0.02).name('ripple detail');
fSurf.add(ocean.uniforms.uDetailScale, 'value', 0.05, 1.2, 0.01).name('ripple scale');
fSurf.add(ocean.uniforms.uRefractStrength, 'value', 0.0, 0.12, 0.005).name('refraction');
fSurf.add(ocean.uniforms.uSSRStrength, 'value', 0.0, 1.0, 0.02).name('reflections (SSR)');
fSurf.add(ocean.uniforms.uSunGlitter, 'value', 0.0, 1.0, 0.02).name('sun glitter');
fSurf.add(ocean.uniforms.uRoughness, 'value', 0.02, 0.5, 0.01).name('micro roughness');

const fColor = gui.addFolder('Water & colour').close().hide();
fColor.add(ocean.uniforms.uClarity, 'value', 0.3, 3.0, 0.05).name('clarity');
fColor.add(ocean.uniforms.uDepthFalloff, 'value', 0.03, 0.5, 0.01).name('depth falloff');
fColor.add(ocean.uniforms.uSSSStrength, 'value', 0.0, 1.5, 0.02).name('translucency');
addColorCtrl(fColor, ocean.uniforms.uShallowColor, 'shallow');
addColorCtrl(fColor, ocean.uniforms.uDeepColor, 'deep');
addColorCtrl(fColor, ocean.uniforms.uFoamColor, 'foam');

const fFoam = gui.addFolder('Foam').close().hide();
fFoam.add(ocean.uniforms.uFoamCoverage, 'value', 0.0, 2.0, 0.05).name('coverage');
fFoam.add(ocean.uniforms.uFoamEdge, 'value', 0.02, 0.45, 0.01).name('softness / layers');
fFoam.add(ocean.uniforms.uFoamOpacity, 'value', 0.3, 1.0, 0.02).name('opacity');
fFoam.add(ocean.uniforms.uCrestFoamStart, 'value', 0.3, 3.0, 0.05).name('whitecap onset');
fFoam.add(ocean.uniforms.uFoamThreshold, 'value', 0.0, 1.0, 0.02).name('breaking foam');
fFoam.add(ocean.uniforms.uShoreFoamWidth, 'value', 0.0, 8.0, 0.1).name('shore foam width');
fFoam.add(ocean.uniforms.uContactFoam, 'value', 0.0, 2.0, 0.05).name('object foam / wakes');

const fObj = gui.addFolder('Objects').close().hide();
fObj.add({ s: () => dropAtTarget('sphere') }, 's').name('drop sphere');
fObj.add({ c: () => dropAtTarget('cube') }, 'c').name('drop cube');
fObj.add({ x: () => bodies.clear() }, 'x').name('clear objects');
fObj.add(bodies, 'gravity', 0, 45, 0.5).name('gravity');

const fClouds = gui.addFolder('Volumetric clouds').close().hide();
const cu = clouds.uniforms;
fClouds.add({ on: true }, 'on').name('enabled').onChange(setCloudsEnabled);
fClouds.add(cu.uSteps, 'value', 16, 80, 2).name('quality (steps)');
fClouds.add(cu.uCoverage, 'value', 0.1, 0.95, 0.01).name('coverage');
fClouds.add(cu.uDensity, 'value', 0.2, 3.0, 0.05).name('density');
fClouds.add(cu.uNoiseScale, 'value', 0.002, 0.02, 0.0005).name('cloud size (inv)');
fClouds.add(cu.uHeightFalloff, 'value', 0.0, 1.0, 0.02).name('roundness');
fClouds.add(cu.uDetail, 'value', 0.0, 1.0, 0.02).name('wispiness');
fClouds.add(cu.uBase, 'value', 120, 900, 10).name('altitude');
fClouds.add(cu.uHeight, 'value', 100, 700, 10).name('thickness');
fClouds.add(cu.uWindSpeed, 'value', 0.0, 0.15, 0.005).name('wind speed');
fClouds.add(cu.uSunStrength, 'value', 0.5, 6.0, 0.1).name('sun strength');
fClouds.add(cu.uAmbient, 'value', 0.0, 1.2, 0.02).name('ambient');
fClouds.add(cloudShadowP, 'strength', 0.0, 1.0, 0.02).name('sea shadows');

const fUnder = gui.addFolder('Underwater').close();
fUnder.add(post.underwaterMat.uniforms.uShaftDensity, 'value', 0.0, 0.2, 0.005).name('god-ray density');
fUnder.add(post.underwaterMat.uniforms.uFogStrength, 'value', 0.0, 2.0, 0.05).name('fog strength');

const fPost = gui.addFolder('Post').close().hide();
fPost.add(post.compositeMat.uniforms.uExposure, 'value', 0.3, 2.0, 0.02).name('exposure');
fPost.add(post.compositeMat.uniforms.uBloom, 'value', 0.0, 2.0, 0.02).name('bloom');
fPost.add(post, 'bloomStreak', 0.0, 1.0, 0.02).name('anamorphic streak');
fPost.add(post.compositeMat.uniforms.uSaturation, 'value', 0.5, 1.6, 0.02).name('saturation');
fPost.add(post.compositeMat.uniforms.uContrast, 'value', 0.8, 1.3, 0.01).name('contrast');
fPost.add(post.compositeMat.uniforms.uGrain, 'value', 0.0, 0.2, 0.005).name('film grain');
fPost.add(post.compositeMat.uniforms.uCA, 'value', 0.0, 2.0, 0.05).name('lens fringe');
fPost.add(post.compositeMat.uniforms.uVignetteAir, 'value', 0.0, 0.6, 0.02).name('vignette');

// Headlight intensity — the ONLY light that brightens organisms underwater.
// Kept visible (not inside the hidden Post folder) so the natural-illumination
// vs. glow balance can be tuned live in the browser.
const fTorch = gui.addFolder('Torch').close();
fTorch.add(torchCfg, 'intensity', 0, 600, 5).name('headlight intensity');

gui.add({ dive: () => diveTo(-12) }, 'dive').name('▼ dive under');
gui.add({ seabed: () => diveTo(-140) }, 'seabed').name('⚓ dive to seabed (-140m)');
gui.add({ surface: () => diveTo(14) }, 'surface').name('▲ back to surface');

function diveTo(y) {
  // Smoothly move the camera + target across the surface.
  const from = camera.position.clone();
  const fromT = controls.target.clone();
  const toPos = new THREE.Vector3(from.x, y, from.z);
  const toTgt = new THREE.Vector3(fromT.x, y < 0 ? y - 4 : 2, fromT.z);
  let t = 0;
  
  controls.enabled = false;
  
  (function step() {
    t = Math.min(1, t + 0.02);
    const e = t * t * (3 - 2 * t);
    camera.position.lerpVectors(from, toPos, e);
    
    const currentTarget = new THREE.Vector3().lerpVectors(fromT, toTgt, e);
    camera.lookAt(currentTarget);
    
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      controls.enabled = true;
    }
  })();
}

// ---------------------------------------------------------------------------
//  Resize
// ---------------------------------------------------------------------------
function onResize() {
  const w = sizeW();
  const h = sizeH();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  refractionRT.dispose();
  hdrRT.dispose();
  refractionRT = makeSceneRT(w, h);
  hdrRT = makeSceneRT(w, h);
  ocean.uniforms.uRefractionTex.value = refractionRT.texture;
  ocean.uniforms.uDepthTex.value = refractionRT.depthTexture;

  ocean.setResolution(w, h);
  post.setSize(w, h);
  clouds.setSize(w, h);
  globeView.setSize(w, h);
}
window.addEventListener('resize', onResize);



// ---------------------------------------------------------------------------
//  Render loop
// ---------------------------------------------------------------------------
let lastNow = performance.now();
let time = 0;
let frame = 0;
const invProjView = new THREE.Matrix4();

function setVisible(underwater, refractionPass) {
  if (refractionPass) {
    // Background behind the water: sky + floor only.
    ocean.mesh.visible = false;
    sky.mesh.visible = true;
    floor.mesh.visible = true;
    particles.points.visible = false;
    if (creatureLoader.group) creatureLoader.group.visible = false;
    if (coralManager.group) coralManager.group.visible = false;
  } else {
    ocean.mesh.visible = true;
    sky.mesh.visible = !underwater;
    floor.mesh.visible = true;
    particles.points.visible = underwater;
    if (creatureLoader.group) creatureLoader.group.visible = true;
    if (coralManager.group) coralManager.group.visible = true;
  }
}

let fpsFrames = 0;
let fpsLastTime = performance.now();
let currentFps = 60;

// One-shot boot-overlay hide, reached from whichever renders first: the globe
// branch (first globe frame) or the ocean path (frame === 2).
let bootHidden = false;
function hideBoot() {
  if (bootHidden) return;
  bootHidden = true;
  bootEl.classList.add('hidden');
  depthEl.hidden = false;
  setTimeout(() => bootEl.remove(), 1200);
  setTimeout(() => (hintEl.style.opacity = '0'), 7000);
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.05);
  lastNow = now;

  // MODE 1 — globe entry point: render the globe straight to screen and bypass
  // the ENTIRE ocean pipeline (subsystem updates, Pass A/B, clouds, post).
  if (mode === 'globe') {
    globeView.update(dt);
    globeView.render();
    hideBoot();
    return;
  }

  profiler.frameStart();

  // FPS calculation
  fpsFrames++;
  if (now - fpsLastTime >= 500) {
    currentFps = (fpsFrames * 1000) / (now - fpsLastTime);
    fpsFrames = 0;
    fpsLastTime = now;
  }

  // 1. Independent Subsystem Updates with Error Isolation
  profiler.start('coral');
  try {
    coralManager.update(dt);
  } catch (e) {
    console.error('[CoralManager] Update error:', e);
  }
  profiler.end('coral');

  profiler.start('instruments');
  try {
    instrumentManager.update(time, dt);
  } catch (e) {
    console.error('[InstrumentManager] Update error:', e);
  }
  profiler.end('instruments');

  profiler.start('eco');
  try {
    ecosystemAI.update(dt, now, camera.position);
  } catch (e) {
    console.error('[EcosystemAI] Update error:', e);
  }
  profiler.end('eco');

  // Update creature animation mixers & check Codex proximity focus/discoveries
  try {
    profiler.start('mixers');
    creatures.forEach((c) => {
      if (c.mixer) c.mixer.update(dt);
    });
    profiler.end('mixers');
    // The registry list (creatures + instruments + wreck) feeds the ship's avoidance
    // scan — the ship must NOT avoid itself, so it is deliberately excluded here. The
    // container ship IS a focusable entity, but as a VESSEL, not a species: it is fed to
    // the Codex via the radar list below, where KnowledgeBuilder.createObjectProfile
    // resolves it as a vessel — it never enters the biological species pipeline.
    const registryEntities = [
      ...creatures,
      ...instrumentManager.getEntities(),
      shipwreckManager.getEntity()
    ].filter(Boolean);
    // Move the ship before building the radar list so its new position shows this
    // frame; it steers around every entity in the registry list.
    try {
      shipManager.update(dt, time, ocean, registryEntities);
    } catch (e) {
      console.error('[ContainerShip] Update error:', e);
    }
    const shipEntity = shipManager.getEntity();
    const radarEntities = shipEntity ? [...registryEntities, shipEntity] : registryEntities;
    profiler.start('codexRadar');
    // Feed the radar list (which INCLUDES the ship) to the Codex so the vessel is
    // discoverable/focusable. Creatures, instruments and the wreck are unchanged; the
    // ship short-circuits to a vessel profile in createObjectProfile (no species lookup).
    codex.update(time, radarEntities);
    radar.update(camera, radarEntities);
    profiler.end('codexRadar');
  } catch (e) {
    console.error('[Creature/Codex/Radar] Update error:', e);
  }

  // Update UI Debug overlay
  try {
    // §3: the Stats Argo count MUST come from the SAME source of truth as the
    // Ocean Data panel — the real ObservationLayer the panel populates — NOT the
    // demo InstrumentManager (which held a hardcoded set and reported 4 while the
    // panel showed 6). Active = valid observations (what the panel counts);
    // Displayed = rendered markers; API = raw rows returned by the service.
    const argoApi = (dataVizPanel && dataVizPanel.observations) ? dataVizPanel.observations.length : 0;
    const argoActive = (observationLayer && observationLayer.observations) ? observationLayer.observations.length : 0;
    const argoDisplayed = (observationLayer && observationLayer._models) ? observationLayer._models.length : 0;
    const sig = `${argoApi}/${argoActive}/${argoDisplayed}`;
    if (sig !== animate._argoSig) {
      animate._argoSig = sig;
      console.log(`[Stats] Argo API count ${argoApi} / Active Argo count ${argoActive} / Displayed Argo count ${argoDisplayed}`);
    }
    uiManager.updateDebug(
      currentFps,
      creatures.length,
      ecosystemAI.schoolManager.getSchoolCount(),
      argoActive,
      instrumentManager.getEntities().filter(e => e.category === 'glider').length,
      camera.position.y < 0 ? Math.abs(camera.position.y) : 0
    );
  } catch (e) {
    console.error('[UIManager] Update error:', e);
  }
  time += dt;
  controls.update(dt);

  // Surface immersion test (exact wave height at the camera column).
  const surfaceH = ocean.heightAt(camera.position.x, camera.position.z, time);
  const underwater = camera.position.y < surfaceH - 0.15;
  currentUnderwater = underwater;

  // Keep the camera above the seabed.
  if (camera.position.y < -FLOOR_DEPTH + 3) camera.position.y = -FLOOR_DEPTH + 3;

  profiler.start('scene');
  // [Regression fix] Error-isolate the per-frame ocean UPDATES, matching the
  // subsystem isolation used above (coral / instruments / eco / creatures). This
  // block was previously UNGUARDED: any throw here aborted animate() BEFORE the
  // render below, so the shared WebGL canvas kept showing the last globe frame
  // (Earth) while the DOM radar — updated earlier in the frame — kept moving.
  // Now a throw is logged once and the scene still reaches the render pass.
  try {
  ocean.update(time, camera);
  floor.update(time, camera);
  // Feed the submarine torch pose (world space) to the seabed shader so the
  // beam pool tracks the camera. Off above water. Light + target are parented
  // to the camera, so their world transforms already include heading/dive.
  if (underwater) {
    submarineLight.getWorldPosition(_torchPos);
    submarineLight.target.getWorldPosition(_torchTarget);
    _torchDir.subVectors(_torchTarget, _torchPos).normalize();
    floor.setTorch(true, _torchPos, _torchDir);
  } else {
    floor.setTorch(false);
  }
  // island.update(time); // Removed island rendering
  particles.update(time, camera);
  sky.update(camera, time);
  bodies.update(dt, time, ocean, terrainAt);
  profiler.end('scene');

  ocean.uniforms.uCameraUnderwater.value = underwater ? 1 : 0;
  ocean.uniforms.uProjMatrix.value.copy(camera.projectionMatrix);
  post.underwaterMat.uniforms.uTime.value = time;

  // Underwater base lighting (depth absorption is handled in Post.js)
  if (underwater) {
    underwaterAmbient.intensity = 0.6;  // Low ambient so the torch cone reads; outside-beam is dark blue
    underwaterFill.intensity = 0.35;
    skyLight.intensity = 0.4;
    sunLight.intensity = (0.6 + 3.0 * Math.max(sunDir.y, 0.0)) * 0.3;
    submarineLight.intensity = (headlightOverride !== null) ? headlightOverride : torchCfg.intensity; // Submarine headlight
    // Headlight target is parented to the camera (set once above); it follows heading automatically.
  } else {
    underwaterAmbient.intensity = 0.0;
    underwaterFill.intensity = 0.0;
    skyLight.intensity = 1.1;
    sunLight.intensity = 0.6 + 3.0 * Math.max(sunDir.y, 0.0);
    submarineLight.intensity = 0.0;
  }

  // Feed floating bodies into the ocean's contact-foam field (rings, wakes,
  // splash bursts). Strength blends wetness, speed and any recent splash.
  const ou = ocean.uniforms;
  const blist = bodies.bodies;
  const bn = Math.min(blist.length, MAX_FOAM_BODIES);
  ou.uBodyCount.value = bn;
  for (let i = 0; i < bn; i++) {
    const b = blist[i];
    const spd = Math.hypot(b.vx, b.vz);
    const wet = b.wet || 0;
    const strength = wet > 0.02
      ? Math.min(2, (0.3 + spd * 0.22 + (b.splash || 0)) * Math.min(wet * 3, 1))
      : Math.min(2, b.splash || 0);
    ou.uBodies.value[i].set(b.mesh.position.x, b.mesh.position.z, b.r * 1.15, strength);
    ou.uBodyVel.value[i].set(b.vx, b.vz);
  }

  // Sync the sea's cloud shadows with the volumetric layer (drift, coverage).
  if (clouds.enabled) {
    ou.uCloudShadow.value = cloudShadowP.strength;
    ou.uCloudPlaneY.value = cu.uBase.value + cu.uHeight.value * 0.5;
    ou.uCloudScale.value = cu.uNoiseScale.value;
    ou.uCloudCoverage.value = cu.uCoverage.value * (1 - cu.uHeightFalloff.value * 0.5);
    ou.uCloudDrift.value.copy(cu.uDrift.value);
  }
  } catch (e) {
    if (!animate._sceneErr) { animate._sceneErr = true; console.error('[OceanScene] per-frame update threw (ocean still renders below):', e); }
  }

  renderer.setClearColor(OCEAN_CONFIG.deepColor, 1);
  profiler.start('render');
  // [Regression fix + diagnosis] Error-isolate the RENDER pipeline too. If any
  // scene object or pass ever throws mid-render, log it ONCE instead of silently
  // aborting the frame and leaving the canvas frozen on the previous globe image.
  try {

  // --- Pass A: refraction background (skip while submerged) ---
  if (!underwater) {
    setVisible(underwater, true);
    renderer.setRenderTarget(refractionRT);
    renderer.render(scene, camera);
  }

  // --- Pass B: full scene to HDR ---
  setVisible(underwater, false);
  renderer.setRenderTarget(hdrRT);
  renderer.render(scene, camera);

  // --- Volumetric clouds: raymarch a low-res HDR buffer from the scene depth ---
  if (clouds.enabled && !underwater) clouds.render(dt, camera, hdrRT.depthTexture);

  // --- Post: underwater volumetrics + clouds + bloom + tone-map to screen ---
  invProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
  post.render(hdrRT, {
    invProjView,
    cameraPos: camera.position,
    sunDir,
    time,
    underwater,
    surfaceY: OCEAN_CONFIG.surfaceY,
    cloudTexture: (clouds.enabled && !underwater) ? clouds.texture : null,
  });
  } catch (e) {
    if (!animate._renderErr) { animate._renderErr = true; console.error('[OceanRender] render pipeline threw — THIS is why the ocean did not appear (canvas stayed on the last globe frame):', e); }
  }
  profiler.end('render');

  // --- HUD ---
  const depthBelow = surfaceH - camera.position.y;
  depthStateEl.textContent = underwater ? 'BELOW' : 'ABOVE';
  depthStateEl.style.color = underwater ? '#7fe0d0' : '#9be7ff';
  depthValEl.textContent = (underwater ? depthBelow : camera.position.y).toFixed(1) + ' m';

  frame++;
  if (frame === 2) hideBoot();
  profiler.frameEnd();
}

window.getSeabedCoralDebug = () => {
  const floorBaseY = floor.mesh.position.y;   // flat plane base (-depth); dunes rise above it
  const corals = coralManager.corals.map((anchor) => {
    anchor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(anchor);
    const worldPos = new THREE.Vector3();
    anchor.getWorldPosition(worldPos);
    // Real, undulating seabed height directly under THIS coral (not the flat base).
    const seabedLocalY = floor.heightAt ? floor.heightAt(worldPos.x, worldPos.z) : floorBaseY;
    const gapToSeabed = box.min.y - seabedLocalY;   // ~ -0.5 when planted (0.5 embedded); >0 = floating
    return {
      name: anchor.name,
      parent: anchor.parent?.type || 'none',
      anchorPos: { x: worldPos.x.toFixed(2), y: worldPos.y.toFixed(2), z: worldPos.z.toFixed(2) },
      worldMinY: box.min.y.toFixed(2),
      worldMaxY: box.max.y.toFixed(2),
      height: (box.max.y - box.min.y).toFixed(2),
      seabedLocalY: seabedLocalY.toFixed(2),
      gapToSeabed: gapToSeabed.toFixed(2),
      isBelowSurface: box.max.y < 0,
      isFirmlyOnSeabed: gapToSeabed <= 1.0 && gapToSeabed >= -3.0
    };
  });
  const wreck = shipwreckManager.getEntity();
  let wreckData = null;
  if (wreck && wreck.model) {
    wreck.model.updateMatrixWorld(true);
    const wBox = new THREE.Box3().setFromObject(wreck.model);
    const wPos = wreck.model.position;
    const wSeabedY = floor.heightAt ? floor.heightAt(wPos.x, wPos.z) : floorBaseY;
    wreckData = {
      name: wreck.name,
      worldMinY: wBox.min.y.toFixed(2),
      worldMaxY: wBox.max.y.toFixed(2),
      seabedLocalY: wSeabedY.toFixed(2),
      gapToSeabed: (wBox.min.y - wSeabedY).toFixed(2),
      isBelowSurface: wBox.max.y < 0
    };
  }
  const report = {
    surfaceY: 0,
    floorBaseY,
    cameraY: camera.position.y.toFixed(2),
    coralCount: corals.length,
    corals,
    shipwreck: wreckData
  };
  console.log('ACTUAL RUNTIME CORAL DEBUG:', JSON.stringify(report, null, 2));
  return report;
};

// Small handle for debugging / automation (harmless in production).
window.OCEAN = { camera, controls, diveTo, sunParams, applySun, applyPreset, PRESETS, ocean, floor, island, post, bodies, dropObject, dropAtTarget, clouds, setCloudsEnabled, codex, uiManager, shipManager };

// --- DEV-only performance instrument (read-only; no behaviour change) ---
let currentUnderwater = false;
// Default null = normal behaviour untouched. Set 0/800 to isolate headlight cost.
let headlightOverride = null;
const profiler = new PerformanceProfiler();
profiler.attach(renderer, () => {
  let mixers = 0;
  for (let i = 0; i < creatures.length; i++) if (creatures[i].mixer) mixers++;
  let lights = 0;
  for (const L of [sunLight, skyLight, underwaterAmbient, underwaterFill, submarineLight]) {
    if (L && L.intensity > 0) lights++;
  }
  const partAttr = particles?.points?.geometry?.attributes?.position;
  return {
    creatures: creatures.length,
    schools: ecosystemAI.schoolManager.getSchoolCount(),
    mixers,
    coral: coralManager.corals ? coralManager.corals.length : 0,
    particles: partAttr ? partAttr.count : 0,
    lights,
    post: 'on',
    underwater: currentUnderwater,
  };
});
window.OCEAN.profiler = profiler;
// DEV headlight isolation for the G/H perf test: OCEAN.setHeadlight(true|false|null)
window.OCEAN.setHeadlight = (on) => { headlightOverride = (on === null) ? null : (on ? torchCfg.intensity : 0); };
// Live headlight tuning without a rebuild: OCEAN.setTorchIntensity(130) etc.
window.OCEAN.setTorchIntensity = (v) => { torchCfg.intensity = Math.max(0, +v || 0); return torchCfg.intensity; };

applySun();
setCloudsEnabled(true); // volumetric clouds on by default (toggle in the GUI)
animate();
