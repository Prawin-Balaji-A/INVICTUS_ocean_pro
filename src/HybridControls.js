import * as THREE from 'three';

export class HybridControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // Public API for compatibility
    this.target = new THREE.Vector3(0, 2, 0);
    this.enabled = true;
    this.autoRotate = false;
    
    // --- Heading (yaw managed internally) ---
    // The player's heading is stored as a separate yaw angle.
    // Camera pitch/yaw for LOOK is decoupled from steering heading.
    this.heading = 0; // Radians — the direction the "vehicle" faces (Y-axis rotation)

    // Movement Physics
    this.baseSpeed = 14;
    this.boostSpeed = 32;
    this.acceleration = 8;
    this.friction = 6;

    // Steering Physics (A/D — yaw rotation of the vehicle heading)
    this.steerSpeed = 1.8;       // Radians per second at full steering
    this.steerAcceleration = 8;  // How fast steering ramps up
    this.steerFriction = 8;      // How fast steering damps when released

    // Look Physics (IJKL — independent camera look offset)
    this.lookSpeed = 1.4;        // Radians per second
    this.lookAcceleration = 10;
    this.lookFriction = 8;

    // Internal state
    this.velocity = new THREE.Vector3();
    this.steerVelocity = 0;      // Current yaw angular velocity from A/D
    this.lookAngularVelocity = { pitch: 0, yaw: 0 }; // From IJKL

    // Camera look offset relative to heading
    this.lookPitch = 0;   // Pitch of camera (up/down look via I/K)
    this.lookYawOffset = 0; // Yaw offset from heading (left/right look via J/L)

    this.keys = {
      forward: false,      // W
      backward: false,     // S
      steerLeft: false,    // A — turn heading left
      steerRight: false,   // D — turn heading right
      lookUp: false,       // I
      lookDown: false,     // K
      lookLeft: false,     // J
      lookRight: false,    // L
      up: false,           // Space
      down: false,         // Ctrl / C
      boost: false         // Shift
    };

    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Initialize heading from current camera orientation
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.heading = this.euler.y;
    this.lookPitch = this.euler.x;

    this.isLocked = false;
    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener('keydown', (e) => this._onKey(e, true));
    document.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, isDown) {
    // Ignore input if typing in UI text inputs
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    switch (e.code) {
      // Throttle (forward/backward along heading)
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = isDown;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = isDown;
        break;

      // Steering (yaw rotation of heading)
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.steerLeft = isDown;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.steerRight = isDown;
        break;

      // Independent Camera Look (IJKL)
      case 'KeyI':
        this.keys.lookUp = isDown;
        break;
      case 'KeyK':
        this.keys.lookDown = isDown;
        break;
      case 'KeyJ':
        this.keys.lookLeft = isDown;
        break;
      case 'KeyL':
        this.keys.lookRight = isDown;
        break;

      // Vertical Translation
      case 'Space':
        this.keys.up = isDown;
        if (isDown) e.preventDefault(); // Prevent page scroll
        break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC':
        this.keys.down = isDown;
        break;

      // Boost
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.boost = isDown;
        break;
    }
  }

  update(dt = 0.016) {
    // Cap dt to avoid teleporting on lag spikes
    const delta = Math.min(dt, 0.1);

    // ─── 1. STEERING (A/D) → Modify the vehicle heading ───
    let targetSteer = 0;
    if (this.keys.steerLeft) targetSteer += this.steerSpeed;
    if (this.keys.steerRight) targetSteer -= this.steerSpeed;

    // Cinematic Auto-Yaw applies to heading
    if (this.autoRotate && this.enabled) {
      targetSteer -= 0.12;
    }

    // Smooth steering acceleration/damping
    const steerSmooth = 1.0 - Math.exp(-this.steerAcceleration * delta);
    this.steerVelocity += (targetSteer - this.steerVelocity) * steerSmooth;

    // Apply steering to heading
    if (Math.abs(this.steerVelocity) > 0.0001) {
      this.heading += this.steerVelocity * delta;
    }

    // ─── 2. INDEPENDENT LOOK (I/K/J/L) → Camera look offset ───
    let targetLookPitch = 0;
    let targetLookYaw = 0;

    if (this.keys.lookUp) targetLookPitch += this.lookSpeed;
    if (this.keys.lookDown) targetLookPitch -= this.lookSpeed;
    if (this.keys.lookLeft) targetLookYaw += this.lookSpeed;
    if (this.keys.lookRight) targetLookYaw -= this.lookSpeed;

    const lookSmooth = 1.0 - Math.exp(-this.lookAcceleration * delta);
    this.lookAngularVelocity.pitch += (targetLookPitch - this.lookAngularVelocity.pitch) * lookSmooth;
    this.lookAngularVelocity.yaw += (targetLookYaw - this.lookAngularVelocity.yaw) * lookSmooth;

    // Update look offsets
    if (Math.abs(this.lookAngularVelocity.pitch) > 0.0001) {
      this.lookPitch += this.lookAngularVelocity.pitch * delta;
    }
    if (Math.abs(this.lookAngularVelocity.yaw) > 0.0001) {
      this.lookYawOffset += this.lookAngularVelocity.yaw * delta;
    }

    // Clamp pitch to [-88 deg, +88 deg] to prevent camera flipping
    const maxPitch = 1.53; // ~88 degrees in radians
    this.lookPitch = Math.max(-maxPitch, Math.min(maxPitch, this.lookPitch));

    // ─── 3. BUILD FINAL CAMERA ORIENTATION ───
    // Camera yaw = heading + look yaw offset
    // Camera pitch = look pitch
    this.euler.set(this.lookPitch, this.heading + this.lookYawOffset, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    if (!this.enabled) return;

    // ─── 4. TRANSLATION (W/S along heading, Space/Ctrl vertical) ───
    // Movement direction is based on HEADING, not camera look direction.
    // This means looking around with IJKL doesn't change where you drive.
    const headingForward = new THREE.Vector3(
      -Math.sin(this.heading),
      0,
      -Math.cos(this.heading)
    );

    const targetVel = new THREE.Vector3();

    // W/S = throttle along heading direction
    let throttle = 0;
    if (this.keys.forward) throttle += 1;
    if (this.keys.backward) throttle -= 1;

    if (throttle !== 0) {
      targetVel.addScaledVector(headingForward, throttle);
    }

    // Space/Ctrl = vertical elevation (absolute Y)
    if (this.keys.up) targetVel.y += 1;
    if (this.keys.down) targetVel.y -= 1;

    if (targetVel.lengthSq() > 0) {
      targetVel.normalize();
    }

    const currentMaxSpeed = this.keys.boost ? this.boostSpeed : this.baseSpeed;
    targetVel.multiplyScalar(currentMaxSpeed);

    // Apply smooth linear acceleration/friction
    this.velocity.lerp(targetVel, 1.0 - Math.exp(-this.acceleration * delta));
    
    if (this.velocity.lengthSq() > 0.0001) {
      this.camera.position.addScaledVector(this.velocity, delta);
    } else {
      this.velocity.set(0, 0, 0);
    }

    // Keep compatibility target strictly in front of camera
    this.camera.getWorldDirection(this.target);
    this.target.multiplyScalar(10).add(this.camera.position);
  }
}
