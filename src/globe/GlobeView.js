import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GlobeCoordinateTransform } from './GlobeCoordinateTransform.js';

/**
 * GlobeView — MODE 1, the interactive 3D Earth entry point. It owns its OWN
 * lightweight scene + perspective camera + OrbitControls and renders directly to
 * the screen; it shares only the WebGLRenderer with the ocean. The existing
 * ocean pipeline is never touched — main.js simply bypasses it while the globe
 * is on screen.
 *
 * The Earth texture is the user-supplied equirectangular basemap discovered from
 * src/assets/earth/ via a BUILD-SAFE import.meta.glob (the same ?url pattern used
 * by AssetManifest.js / ObservationLayer.js). If no image is present the glob
 * returns {} and we fall back to an explicit neutral placeholder + graticule —
 * we NEVER download, generate, or substitute an Earth texture. Latitude/longitude
 * picking works either way, because it comes from real sphere-intersection math
 * (GlobeCoordinateTransform), not from the texture.
 */

// Build-time discovery of the user's Earth basemap. Empty object ⇒ no asset yet.
const earthModules = import.meta.glob('../assets/earth/*.{jpg,jpeg,png,webp}', {
  query: '?url',
  import: 'default',
  eager: true,
});

const GLOBE_RADIUS = 100;
const PIN_COLOR = 0x4fe3ff;   // matches the ocean selection cyan (ObservationLayer HILITE)

export class GlobeView {
  constructor(renderer, { onPick = null } = {}) {
    this.renderer = renderer;
    this.onPick = onPick;
    this.transform = new GlobeCoordinateTransform({ radius: GLOBE_RADIUS });
    this._bg = new THREE.Color(0x05070d);       // space backdrop
    this._raycaster = new THREE.Raycaster();

    // §1 land/ocean classification. Filled asynchronously from the SAME
    // user-supplied Earth image the sphere is textured with (no extra asset, no
    // download): the image is drawn once to an offscreen canvas and its pixels
    // are sampled per pick. Until it loads (or if no Earth image exists) this is
    // null and classifyAt() returns 'unknown' — picking is never blocked on it.
    this._maskData = null;
    this._maskW = 0;
    this._maskH = 0;

    this.scene = new THREE.Scene();
    const w = window.innerWidth, h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
    // Open looking at the north Indian Ocean — this platform's focus region.
    this.transform.lonLatToPoint(12, 80, GLOBE_RADIUS * 3, this.camera.position);

    // Even, readable illumination so EVERY ocean is visible and pickable. A
    // day/night terminator (from a single light) would hide half the globe.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(1, 0.6, 1);
    this.scene.add(key);

    // ---- Earth sphere: user texture, or explicit placeholder ----------------
    const urls = Object.values(earthModules);
    this.assetMissing = urls.length === 0;
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64);
    let material;
    if (!this.assetMissing) {
      const tex = new THREE.TextureLoader().load(urls[0]);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
      // Sample the same image's pixels for land/ocean picking (§1).
      this._loadOceanMask(urls[0]);
    } else {
      // Neutral placeholder — honest "no data" grey-blue, never fake continents.
      material = new THREE.MeshStandardMaterial({ color: 0x243447, roughness: 1, metalness: 0 });
    }
    this.sphere = new THREE.Mesh(geo, material);
    this.sphere.name = 'GlobeEarth';
    this.scene.add(this.sphere);

    // A reference graticule only in placeholder mode (keeps the real Earth clean).
    if (this.assetMissing) this.scene.add(this._buildGraticule());

    // ---- Selection pin (procedural primitive — allowed, like the halo) ------
    this.pin = this._buildPin();
    this.pin.visible = false;
    this.scene.add(this.pin);

    // ---- Orbit + zoom (pan disabled → globe stays centred, picking stable) --
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = GLOBE_RADIUS * 1.25;
    this.controls.maxDistance = GLOBE_RADIUS * 5;
    this.controls.update();
  }

  _buildPin() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: PIN_COLOR });
    const spikeH = GLOBE_RADIUS * 0.14;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(GLOBE_RADIUS * 0.03, spikeH, 20), mat);
    spike.position.y = spikeH / 2;   // base at group origin, apex outward (+Y pre-orient)
    group.add(spike);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * 0.022, 16, 12), mat);
    group.add(dot);                  // sits exactly on the surface point
    return group;
  }

  _buildGraticule() {
    const group = new THREE.Group();
    group.name = 'GlobeGraticule';
    const mat = new THREE.LineBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.25 });
    const R = GLOBE_RADIUS * 1.002;
    for (let lat = -60; lat <= 60; lat += 30) {          // parallels
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 5) pts.push(this.transform.lonLatToPoint(lat, lon, R));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    for (let lon = -180; lon < 180; lon += 30) {         // meridians
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 5) pts.push(this.transform.lonLatToPoint(lat, lon, R));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    return group;
  }

  /** Enable/disable orbit interaction (ocean mode leaves the globe dormant). */
  setEnabled(on) { this.controls.enabled = on; }

  /** Advance damping/auto-rotate. Called only while the globe is on screen. */
  update() { this.controls.update(); }

  /** Draw the globe straight to the screen (no post-processing). */
  render() {
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(this._bg, 1);
    this.renderer.render(this.scene, this.camera);
  }

  setSize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Place the selection pin on the surface at a geographic coordinate. */
  setPin(latitude, longitude) {
    const surf = this.transform.lonLatToPoint(latitude, longitude, GLOBE_RADIUS);
    this.pin.position.copy(surf);
    // Orient the pin's +Y axis to the surface normal so the spike sticks out.
    const n = surf.clone().normalize();
    this.pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    this.pin.visible = true;
  }

  /**
   * Draw the (same, user-supplied) Earth image to an offscreen canvas once, so
   * its pixels can be sampled for land/ocean classification (§1). The image is a
   * bundled same-origin URL, so the canvas is not tainted and getImageData works.
   * Capped to ≤4096 on the long edge to bound memory; classification is
   * resolution-independent (we sample by lat/lon fraction).
   */
  _loadOceanMask(url) {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        this._maskData = ctx.getImageData(0, 0, w, h).data;
        this._maskW = w; this._maskH = h;
        console.log(`[GlobeView] Ocean mask ready from Earth image (${w}×${h}). Land/ocean picking enabled.`);
      } catch (e) {
        // Same-origin bundled asset should never taint; if it somehow does we
        // simply fall back to allowing all picks (classifyAt → 'unknown').
        console.warn('[GlobeView] Could not read Earth image pixels for land/ocean picking:', e?.message || e);
        this._maskData = null;
      }
    };
    img.onerror = () => { console.warn('[GlobeView] Earth image failed to load for land/ocean mask.'); };
    img.src = url;
  }

  /**
   * Classify a geographic point as 'ocean' | 'land' | 'unknown' by sampling the
   * Earth image at the EXACT pixel the globe pin sits on. Mapping is derived to
   * match the SphereGeometry UVs + GlobeCoordinateTransform:
   *   u = (lon + 180) / 360     (image column fraction, +180°W → +180°E)
   *   v = (90  − lat) / 180     (image row fraction, north pole at the top)
   * Blue Marble oceans are blue-dominant; land is green/tan/brown and polar ice
   * is white (R≈G≈B, so NOT blue-dominant → correctly land). A 3×3 majority vote
   * around the pixel avoids a lone anti-aliased coastline texel flipping the call.
   */
  classifyAt(latitude, longitude) {
    if (!this._maskData) return 'unknown';
    const W = this._maskW, H = this._maskH, d = this._maskData;
    let u = (longitude + 180) / 360; u = ((u % 1) + 1) % 1;   // wrap longitude
    let v = (90 - latitude) / 180; v = Math.min(1, Math.max(0, v));
    const cx = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
    const cy = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    let ocean = 0, total = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.min(W - 1, Math.max(0, cx + dx));
        const y = Math.min(H - 1, Math.max(0, cy + dy));
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // Blue dominant over red, and not markedly less than green (shallow water
        // reads cyan, i.e. green ≈ blue): ocean. Everything else: land.
        if (b > r + 10 && b >= g - 10) ocean++;
        total++;
      }
    }
    return ocean * 2 > total ? 'ocean' : 'land';
  }

  /**
   * Raycast an NDC point against the globe and classify the hit as land or ocean
   * (§1). Only OCEAN (or 'unknown', when no Earth pixels are available) sets the
   * selection pin and fires onPick; clicking LAND leaves any prior selection
   * untouched so the caller can prompt "click an ocean area" and stay on the
   * globe. Real lat/lon always comes from sphere-intersection math, never texels.
   * @returns {{latitude:number, longitude:number, terrain:'ocean'|'land'|'unknown'}|null}
   *   null only if the ray missed the sphere (clicked empty space).
   */
  pickAt(ndc) {
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObject(this.sphere, false);
    if (!hits.length) return null;
    const loc = this.transform.pointToLonLat(hits[0].point);
    const terrain = this.classifyAt(loc.latitude, loc.longitude);
    if (terrain === 'land') {
      // Do NOT select land or move the selection pin; the caller shows a hint.
      return { latitude: loc.latitude, longitude: loc.longitude, terrain };
    }
    this.setPin(loc.latitude, loc.longitude);
    if (this.onPick) { try { this.onPick(loc); } catch (_) {} }
    return { latitude: loc.latitude, longitude: loc.longitude, terrain };
  }
}
