import * as THREE from 'three';

export class Radar {
  constructor(options = {}) {
    this.detectionRadius = options.detectionRadius || 150;
    this.maxRadarSize = options.maxRadarSize || 140; // visual size of radar container in px

    // Outer wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.id = 'radar-widget';

    // HUD Header readout
    this.hud = document.createElement('div');
    this.hud.id = 'radar-hud';
    this.hud.innerHTML = `<span id="hud-rng">RNG 150m</span> · <span id="hud-depth">0m</span> · <span id="hud-hdg">000°</span>`;
    this.wrapper.appendChild(this.hud);

    // Circular Radar screen
    this.container = document.createElement('div');
    this.container.id = 'radar';
    this.wrapper.appendChild(this.container);

    // Range rings (concentric 50m, 100m, 150m)
    this.rings = document.createElement('div');
    this.rings.className = 'radar-rings';
    this.rings.innerHTML = `
      <div class="radar-ring ring-50"><span class="ring-label">50m</span></div>
      <div class="radar-ring ring-100"><span class="ring-label">100m</span></div>
      <div class="radar-ring ring-150"></div>
    `;
    this.container.appendChild(this.rings);

    // Forward visibility / scanning cone
    this.forwardCone = document.createElement('div');
    this.forwardCone.className = 'radar-forward-cone';
    this.container.appendChild(this.forwardCone);

    // Rotating compass ring with N/E/S/W
    this.compassRing = document.createElement('div');
    this.compassRing.className = 'radar-compass-ring';
    this.compassRing.innerHTML = `
      <div class="radar-cardinal cardinal-n">N</div>
      <div class="radar-cardinal cardinal-e">E</div>
      <div class="radar-cardinal cardinal-s">S</div>
      <div class="radar-cardinal cardinal-w">W</div>
    `;
    this.container.appendChild(this.compassRing);

    // Player marker centered
    this.playerMarker = document.createElement('div');
    this.playerMarker.className = 'radar-player';
    this.container.appendChild(this.playerMarker);
    
    document.body.appendChild(this.wrapper);
    
    this.injectStyles();
    
    this.blips = new Map(); // Map from creature object reference to DOM element
    
    this._camForward = new THREE.Vector3();
  }
  
  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #radar-widget {
        position: fixed;
        bottom: 260px;
        right: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 100;
        pointer-events: none;
        user-select: none;
      }

      #radar-hud {
        font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.08em;
        color: #7dd3fc;
        background: rgba(7, 17, 26, 0.75);
        border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 4px;
        padding: 2px 8px;
        margin-bottom: 6px;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      }

      #radar {
        position: relative;
        width: ${this.maxRadarSize}px;
        height: ${this.maxRadarSize}px;
        border-radius: 50%;
        background: radial-gradient(circle at center, rgba(14, 32, 46, 0.55) 0%, rgba(7, 17, 26, 0.85) 100%);
        border: 1.5px solid rgba(56, 189, 248, 0.35);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), inset 0 0 25px rgba(56, 189, 248, 0.12);
        backdrop-filter: blur(12px) saturate(1.2);
        -webkit-backdrop-filter: blur(12px) saturate(1.2);
        overflow: hidden;
      }
      
      /* Grid crosshairs */
      #radar::before {
        content: '';
        position: absolute;
        top: 50%; left: 0; right: 0; height: 1px;
        background: rgba(56, 189, 248, 0.2);
        z-index: 1;
      }
      #radar::after {
        content: '';
        position: absolute;
        left: 50%; top: 0; bottom: 0; width: 1px;
        background: rgba(56, 189, 248, 0.2);
        z-index: 1;
      }

      /* Forward field-of-view cone (60 degrees forward) */
      .radar-forward-cone {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
        background: conic-gradient(
          from 330deg at 50% 50%,
          transparent 0deg,
          rgba(56, 189, 248, 0.14) 20deg,
          rgba(56, 189, 248, 0.18) 30deg,
          rgba(56, 189, 248, 0.14) 40deg,
          transparent 60deg,
          transparent 360deg
        );
      }

      /* Concentric range rings */
      .radar-rings {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 1;
      }
      .radar-ring {
        position: absolute;
        border-radius: 50%;
        border: 1px dashed rgba(56, 189, 248, 0.22);
      }
      .ring-50 {
        width: 33.3%;
        height: 33.3%;
        top: 33.3%;
        left: 33.3%;
      }
      .ring-100 {
        width: 66.6%;
        height: 66.6%;
        top: 16.7%;
        left: 16.7%;
      }
      .ring-150 {
        width: 96%;
        height: 96%;
        top: 2%;
        left: 2%;
        border: 1px solid rgba(56, 189, 248, 0.3);
      }
      .ring-label {
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'JetBrains Mono', monospace;
        font-size: 8px;
        color: rgba(125, 211, 252, 0.6);
        background: rgba(7, 17, 26, 0.8);
        padding: 0 2px;
        border-radius: 2px;
      }

      /* Outer compass ring with cardinal points */
      .radar-compass-ring {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
        transition: transform 0.05s linear;
      }
      .radar-cardinal {
        position: absolute;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        font-size: 9.5px;
        color: #7dd3fc;
        text-shadow: 0 0 4px rgba(56, 189, 248, 0.6);
        transform: translate(-50%, -50%);
      }
      .cardinal-n { top: 7px; left: 50%; color: #38bdf8; font-weight: 800; }
      .cardinal-e { top: 50%; left: calc(100% - 7px); }
      .cardinal-s { top: calc(100% - 7px); left: 50%; color: #94a3b8; }
      .cardinal-w { top: 50%; left: 7px; }
      
      .radar-player {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 8px;
        height: 8px;
        margin: -4px 0 0 -4px;
        background: #fff;
        border-radius: 50%;
        box-shadow: 0 0 10px #fff, 0 0 5px #38bdf8;
        z-index: 5;
      }
      
      /* Forward heading chevron for player */
      .radar-player::before {
        content: '';
        position: absolute;
        top: -6px;
        left: 1px;
        border-left: 3px solid transparent;
        border-right: 3px solid transparent;
        border-bottom: 6px solid #38bdf8;
      }
      
      .radar-blip {
        position: absolute;
        top: 0;
        left: 0;
        width: 6px;
        height: 6px;
        margin: -3px 0 0 -3px;
        background: #9be7ff;
        border-radius: 50%;
        box-shadow: 0 0 6px #9be7ff;
        will-change: transform;
        z-index: 4;
      }
      .radar-blip.blip-predator {
        background: #ff5566;
        box-shadow: 0 0 6px #ff5566;
      }
      .radar-blip.blip-buoy {
        background: #ffea00;
        box-shadow: 0 0 6px #ffea00;
      }
      .radar-blip.blip-argo {
        background: #ffaa00;
        box-shadow: 0 0 6px #ffaa00;
      }
      .radar-blip.blip-glider {
        background: #00ffaa;
        box-shadow: 0 0 6px #00ffaa;
      }
      .radar-blip.blip-rov {
        background: #76ff03;
        box-shadow: 0 0 6px #76ff03;
      }
      .radar-blip.blip-shipwreck {
        background: #e0a840;
        box-shadow: 0 0 6px #e0a840;
      }
      /* Surface container ship (InVictus) — distinctive square vessel blip */
      .radar-blip.blip-ship {
        width: 9px;
        height: 9px;
        margin: -4.5px 0 0 -4.5px;
        border-radius: 1.5px;
        background: #f0f9ff;
        border: 1px solid #38bdf8;
        box-shadow: 0 0 8px #38bdf8;
      }
      .radar-blip.blip-feature {
        background: #cc88ff;
        box-shadow: 0 0 6px #cc88ff;
      }
    `;
    document.head.appendChild(style);
  }
  
  update(camera, entities) {
    if (!camera || !entities) return;
    const now = performance.now();
    if (this._lastUpdate && now - this._lastUpdate < 45) return; // ~22 FPS update rate
    this._lastUpdate = now;
    
    // Get camera position
    const cx = camera.position.x;
    const cz = camera.position.z;
    
    // Get camera forward direction (XZ plane)
    camera.getWorldDirection(this._camForward);

    // Update compass ring rotation and HUD readout
    const yaw = Math.atan2(this._camForward.x, this._camForward.z);
    if (this.compassRing) {
      this.compassRing.style.transform = `rotate(${-yaw * 180 / Math.PI}deg)`;
    }
    const depthEl = document.getElementById('hud-depth');
    const hdgEl = document.getElementById('hud-hdg');
    if (depthEl) depthEl.textContent = `${Math.abs(camera.position.y).toFixed(0)}m`;
    if (hdgEl) hdgEl.textContent = `${((yaw * 180 / Math.PI + 360) % 360).toFixed(0).padStart(3, '0')}°`;
    
    // Track which entities are seen this frame
    const seen = new Set();
    
    for (const entity of entities) {
      if (!entity.model && !entity.position) continue;
      
      seen.add(entity);
      
      const pos = entity.model ? entity.model.position : entity.position;
      
      // Get blip or create one
      let blip = this.blips.get(entity);
      if (!blip) {
        blip = document.createElement('div');
        blip.className = 'radar-blip';
        
        // Entity type classification for styling
        if (entity.category === 'buoy' || entity.entityType === 'buoy') {
          blip.classList.add('blip-buoy');
        } else if (entity.category === 'argo' || entity.entityType === 'argo') {
          blip.classList.add('blip-argo');
        } else if (entity.category === 'glider' || entity.entityType === 'glider') {
          blip.classList.add('blip-glider');
        } else if (entity.category === 'rov' || entity.entityType === 'rov') {
          blip.classList.add('blip-rov');
        } else if (entity.entityType === 'shipwreck') {
          blip.classList.add('blip-shipwreck');
        } else if (entity.category === 'ship' || entity.entityType === 'ship') {
          blip.classList.add('blip-ship');
        } else if (entity.profile?.interaction?.predator === true || entity.category === 'shark') {
          blip.classList.add('blip-predator');
        } else if (entity.entityType === 'feature') {
          blip.classList.add('blip-feature');
        }
        
        this.container.appendChild(blip);
        this.blips.set(entity, blip);
      }
      
      // Calculate relative position
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance > this.detectionRadius) {
        blip.style.opacity = '0';
        continue;
      }
      
      // Scale distance to radar radius
      const radarRadius = this.maxRadarSize / 2;
      
      const fx = this._camForward.x;
      const fz = this._camForward.z;
      
      // Right vector is (-fz, fx) in 2D
      const rightX = -fz;
      const rightZ = fx;
      
      const dotForward = dx * fx + dz * fz;
      const dotRight = dx * rightX + dz * rightZ;
      
      const radarX = (dotRight / this.detectionRadius) * radarRadius;
      // Invert Y because screen Y goes down, but forward goes up on radar
      const radarY = -(dotForward / this.detectionRadius) * radarRadius;
      
      // Move to center of radar
      const finalX = radarRadius + radarX;
      const finalY = radarRadius + radarY;
      
      blip.style.opacity = '1';
      blip.style.transform = `translate(${finalX}px, ${finalY}px)`;
    }
    
    // Remove blips for entities that no longer exist
    for (const [entity, blip] of this.blips.entries()) {
      if (!seen.has(entity)) {
        this.container.removeChild(blip);
        this.blips.delete(entity);
      }
    }
  }
}
