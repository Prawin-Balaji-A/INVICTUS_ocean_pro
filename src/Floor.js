import * as THREE from 'three';
import { NOISE, CAUSTICS } from './shaders/common.js';

// --- CPU port of the seabed dune displacement (float32, matches the GPU) ------
// The seabed's rolling dunes are produced ENTIRELY in the Floor vertex shader
// (`wp.y += fbm(wp.xz * uDuneScale, 5) * uDuneHeight`), so the CPU-side plane
// geometry stays flat and an ordinary raycast cannot see the dunes. To seat
// objects (corals, the shipwreck) on the ACTUAL rendered surface, we reproduce
// that same fbm here. hash21()'s fract() of large products is precision-
// sensitive, so every step is evaluated in float32 via Math.fround to match the
// GPU's `highp` result — a plain float64 port diverges by metres near hash-cell
// boundaries. This mirrors NOISE in shaders/common.js EXACTLY (hash21 / noised /
// FBM_M / fbm) and MUST stay in sync with it if that shader chunk changes.
const _F = Math.fround;
function _fract32(x) { return _F(x - Math.floor(x)); }

function _hash21(px, py) {
  // p = fract(p * vec2(123.34, 456.21));
  let x = _fract32(_F(px * _F(123.34)));
  let y = _fract32(_F(py * _F(456.21)));
  // p += dot(p, p + 45.32);
  const ax = _F(x + _F(45.32));
  const ay = _F(y + _F(45.32));
  const dot = _F(_F(x * ax) + _F(y * ay));
  x = _F(x + dot);
  y = _F(y + dot);
  // return fract(p.x * p.y);
  return _fract32(_F(x * y));
}

// noised(x).x — the value channel only (the seabed height ignores the gradient).
function _noisedX(x, y) {
  const ipx = Math.floor(x), ipy = Math.floor(y);
  const fx = _F(x - ipx), fy = _F(y - ipy);
  // u = f*f*f*(f*(f*6-15)+10)
  const ux = _F(_F(_F(fx * fx) * fx) * _F(_F(fx * _F(_F(fx * 6) - 15)) + 10));
  const uy = _F(_F(_F(fy * fy) * fy) * _F(_F(fy * _F(_F(fy * 6) - 15)) + 10));
  const a = _hash21(ipx, ipy);
  const b = _hash21(_F(ipx + 1), ipy);
  const c = _hash21(ipx, _F(ipy + 1));
  const d = _hash21(_F(ipx + 1), _F(ipy + 1));
  const k1 = _F(b - a);
  const k2 = _F(c - a);
  const k3 = _F(_F(_F(a - b) - c) + d);
  // n = a + k1*u.x + k2*u.y + k3*u.x*u.y
  let n = _F(a + _F(k1 * ux));
  n = _F(n + _F(k2 * uy));
  n = _F(n + _F(_F(k3 * ux) * uy));
  return n;
}

// fbm(p, oct) with FBM_M = mat2(1.6,1.2,-1.2,1.6) (column-major ⇒ M*p below).
function _fbm(px, py, oct) {
  let amp = 0.5, sum = 0.0;
  let x = px, y = py;
  const n = Math.min(oct, 8);
  for (let i = 0; i < n; i++) {
    sum = _F(sum + _F(amp * _noisedX(x, y)));
    const nx = _F(_F(_F(1.6) * x) - _F(_F(1.2) * y));
    const ny = _F(_F(_F(1.2) * x) + _F(_F(1.6) * y));
    x = nx; y = ny;
    amp = _F(amp * 0.5);
  }
  return sum;
}

// Sandy seabed: rolling dunes, ripple relief, and two layers of animated
// caustics that only brighten where sunlight reaches. The seabed is kept
// centred under the camera so it feels boundless.
export class Floor {
  constructor(sunDir, depth = 34) {
    this.depth = depth;

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uDepth: { value: depth },
      uDuneHeight: { value: 4.0 },
      uDuneScale: { value: 0.02 },
      uSandColor: { value: new THREE.Color(0.66, 0.58, 0.44) },
      uSandColor2: { value: new THREE.Color(0.46, 0.41, 0.31) },
      uCausticColor: { value: new THREE.Color(1.0, 0.98, 0.85) },
      // Submarine torch (the raw sand shader ignores scene lights, so the beam
      // pool on the seabed is computed explicitly from these camera-fed uniforms).
      uTorchOn: { value: 0.0 },
      uTorchPos: { value: new THREE.Vector3() },
      uTorchDir: { value: new THREE.Vector3(0, -0.2, -1) },
      uTorchCos: { value: Math.cos((Math.PI / 5) * 1.1) },
      uTorchRange: { value: 320.0 },
      uTorchColor: { value: new THREE.Color(0xd4f0ff) },
    };

    const material = new THREE.ShaderMaterial({
      toneMapped: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        precision highp float;
        ${NOISE}
        uniform float uDuneHeight;
        uniform float uDuneScale;
        varying vec3 vWorldPos;

        void main(){
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float dune = fbm(wp.xz * uDuneScale, 5) * uDuneHeight;
          wp.y += dune;
          vWorldPos = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${NOISE}
        ${CAUSTICS}
        uniform float uTime;
        uniform vec3  uSunDir;
        uniform float uDepth;
        uniform float uDuneHeight;
        uniform float uDuneScale;
        uniform vec3  uSandColor;
        uniform vec3  uSandColor2;
        uniform vec3  uCausticColor;
        uniform float uTorchOn;
        uniform vec3  uTorchPos;
        uniform vec3  uTorchDir;
        uniform float uTorchCos;
        uniform float uTorchRange;
        uniform vec3  uTorchColor;
        varying vec3 vWorldPos;

        // Surface normal from the fbm dune/ripple field (analytic gradient).
        vec3 reliefNormal(vec2 p, float slope){
          vec2 g = vec2(0.0);
          float amp = 1.0;
          mat2 m = FBM_M;
          for (int i = 0; i < 5; i++){
            vec3 n = noised(p);
            g += amp * n.yz;
            p = m * p;
            amp *= 0.5;
          }
          return normalize(vec3(-g.x * slope, 1.0, -g.y * slope));
        }

        void main(){
          vec3 sunDir = normalize(uSunDir);
          vec2 xz = vWorldPos.xz;

          // Macro dunes + finer ripples.
          vec3 N = reliefNormal(xz * uDuneScale, uDuneHeight * uDuneScale * 12.0);
          vec3 Nr = reliefNormal(xz * 0.25 + 7.3, 0.35);
          N = normalize(N + vec3(Nr.x, 0.0, Nr.z) * 0.6);

          // Sand albedo with mottled patches.
          float mottle = fbm(xz * 0.06, 4) * 0.5 + 0.5;
          vec3 sand = mix(uSandColor2, uSandColor, smoothstep(0.3, 0.75, mottle));
          sand *= 0.8 + 0.2 * fbm(xz * 0.9, 3);

          // Diffuse sun term (softened; most light underwater is ambient).
          float ndl = clamp(dot(N, sunDir), 0.0, 1.0);
          float diffuse = 0.45 + 0.55 * ndl;

          // Two caustic layers, offset & counter-scrolling, combined sharply.
          float t = uTime * 0.6;
          vec2 flow = sunDir.xz * uTime * 0.4;
          float c1 = caustics(xz * 0.05 + flow, t);
          float c2 = caustics(xz * 0.085 - flow * 0.7 + 15.0, t * 1.3);
          float caus = min(c1, c2) + 0.35 * c1 * c2;

          // Caustics fade with depth and with the sun sinking.
          float reach = clamp(uSunDir.y, 0.0, 1.0);
          reach *= exp(-uDepth * 0.012);
          caus *= (0.4 + 0.9 * ndl);

          vec3 color = sand * diffuse;
          color += uCausticColor * caus * (0.9 + 1.6 * reach);

          // Submarine torch pool: brighten the sand inside the forward cone,
          // fading with distance and cone edge; nothing outside the beam.
          if (uTorchOn > 0.5) {
            vec3 toFrag = vWorldPos - uTorchPos;
            float dist = length(toFrag);
            vec3 dir = dist > 0.0001 ? toFrag / dist : vec3(0.0, -1.0, 0.0);
            float cosAng = dot(dir, normalize(uTorchDir));
            float edge = smoothstep(uTorchCos, mix(uTorchCos, 1.0, 0.35), cosAng);
            float atten = clamp(1.0 - dist / uTorchRange, 0.0, 1.0);
            atten *= atten;
            float torch = edge * atten;
            float ndlTorch = clamp(dot(N, -dir), 0.0, 1.0);
            color += (sand * (0.9 + 0.6 * ndlTorch) + uTorchColor * 0.25) * torch * 1.6;
          }

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.size = 6000;
    const geo = new THREE.PlaneGeometry(this.size, this.size, 256, 256);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.position.y = -depth;
    this.mesh.frustumCulled = false;
  }

  update(time, camera) {
    this.uniforms.uTime.value = time;
    // Follow the camera on a coarse grid so the dune pattern stays put.
    const step = this.size / 256;
    this.mesh.position.x = Math.round(camera.position.x / step) * step;
    this.mesh.position.z = Math.round(camera.position.z / step) * step;
  }

  // World-space Y of the seabed SURFACE at world (x, z) — i.e. exactly what the
  // dune vertex shader renders (mesh base −depth + fbm displacement). Objects are
  // seated on THIS instead of the flat plane so they sit on the real, undulating
  // sand. Dune displacement is in [0, ~3.875] m for the default 5-octave fbm, so
  // the returned surface is always at or above −depth. Cheap: a handful of hash
  // evaluations, intended for one-time placement (not per-frame per-vertex).
  heightAt(x, z) {
    const s = this.uniforms.uDuneScale.value;   // 0.02
    const h = this.uniforms.uDuneHeight.value;  // 4.0
    const dune = _F(_fbm(_F(_F(x) * _F(s)), _F(_F(z) * _F(s)), 5) * _F(h));
    return -this.depth + dune;
  }

  setSun(sunDir) {
    this.uniforms.uSunDir.value.copy(sunDir);
  }

  // Feed the submarine torch (world-space position + forward direction) so the
  // beam pool tracks the camera. Pass on=false to disable (e.g. above water).
  setTorch(on, pos, dir) {
    this.uniforms.uTorchOn.value = on ? 1.0 : 0.0;
    if (on && pos && dir) {
      this.uniforms.uTorchPos.value.copy(pos);
      this.uniforms.uTorchDir.value.copy(dir);
    }
  }
}
