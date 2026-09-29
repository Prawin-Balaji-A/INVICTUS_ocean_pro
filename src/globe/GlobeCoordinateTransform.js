import * as THREE from 'three';

/**
 * GlobeCoordinateTransform — the single source of truth for globe geography
 * (it plays the same role for the globe that GeoTransform plays for the ocean).
 *
 * The math is derived to match Three.js' own SphereGeometry UV layout with an
 * equirectangular (plate-carrée) texture whose prime meridian (0° longitude) is
 * at the horizontal centre of the image and whose top/bottom rows are the north
 * (+90°) / south (−90°) poles:
 *
 *   SphereGeometry vertex:  x = −R·cos(φ)·sin(θ),  y = R·cos(θ),  z = R·sin(φ)·sin(θ)
 *   with φ = u·2π (azimuth, u = image column 0→1) and θ = v·π (polar angle).
 *
 * Inverting that gives:
 *   latitude  = asin(y / R)                     (+90° = north pole, top of image)
 *   longitude = deg( atan2(z, −x) ) − 180       (0° at image centre, +E / −W)
 *
 * Because we never rotate or scale the globe mesh (OrbitControls moves the
 * camera, not the Earth), a raycast hit point is already in this local frame —
 * so pointToLonLat() can be fed the world-space hit point directly.
 */
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export class GlobeCoordinateTransform {
  constructor({ radius = 100 } = {}) {
    this.radius = radius;
  }

  /**
   * Point on the sphere surface → geographic coordinate.
   * Radius-independent (the direction is what matters), so it is safe on any
   * hit point that lies on (or near) the globe surface.
   * @param {THREE.Vector3} point
   * @returns {{latitude:number, longitude:number}}
   */
  pointToLonLat(point) {
    const { x, y, z } = point;
    const r = Math.sqrt(x * x + y * y + z * z) || 1;
    const latitude = Math.asin(THREE.MathUtils.clamp(y / r, -1, 1)) * RAD2DEG;
    let longitude = Math.atan2(z, -x) * RAD2DEG - 180;
    if (longitude < -180) longitude += 360;
    if (longitude > 180) longitude -= 360;
    return { latitude, longitude };
  }

  /**
   * Geographic coordinate → point on a sphere of the given radius (default: the
   * globe surface). Used to place the selection pin and to aim the camera.
   * @param {number} latitude  degrees north
   * @param {number} longitude degrees east
   * @param {number} [radius]
   * @param {THREE.Vector3} [out]
   */
  lonLatToPoint(latitude, longitude, radius = this.radius, out = new THREE.Vector3()) {
    const latRad = latitude * DEG2RAD;
    const alpha = (longitude + 180) * DEG2RAD;
    const cosLat = Math.cos(latRad);
    return out.set(
      -radius * cosLat * Math.cos(alpha),
      radius * Math.sin(latRad),
      radius * cosLat * Math.sin(alpha),
    );
  }
}
