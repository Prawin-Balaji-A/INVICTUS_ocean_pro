/**
 * QualityManager - Adaptive quality settings based on performance
 * 
 * Monitors FPS and adjusts quality settings to maintain smooth performance.
 */

export const QUALITY_PRESETS = {
  HIGH: {
    pixelRatio: 1.5,
    shadowMapSize: 1024,
    enableShadows: false,
    postProcessing: 'full',
    particleCount: 5000,
    maxCreatures: 100,
    maxSchools: 12,
    animationLOD: true,
    perceptionRadius: 50,
    decisionInterval: 1000,
    coralDetail: 'full',
  },
  MEDIUM: {
    pixelRatio: 1.25,
    shadowMapSize: 512,
    enableShadows: false,
    postProcessing: 'reduced',
    particleCount: 3000,
    maxCreatures: 70,
    maxSchools: 8,
    animationLOD: true,
    perceptionRadius: 40,
    decisionInterval: 1200,
    coralDetail: 'reduced',
  },
  LOW: {
    pixelRatio: 1.0,
    shadowMapSize: 256,
    enableShadows: false,
    postProcessing: 'minimal',
    particleCount: 2000,
    maxCreatures: 50,
    maxSchools: 6,
    animationLOD: true,
    perceptionRadius: 30,
    decisionInterval: 1500,
    coralDetail: 'minimal',
  }
};

export class QualityManager {
  constructor() {
    this.currentPreset = 'MEDIUM';
    this.settings = { ...QUALITY_PRESETS.MEDIUM };
    
    // FPS monitoring
    this.targetFPS = 60;
    this.minFPS = 30;
    this.fpsHistory = [];
    this.historySize = 60;
    
    // Adaptation settings
    this.autoAdjust = true;
    this.adjustCooldown = 0;
    this.cooldownDuration = 3000; // 3 seconds between adjustments
    
    // Performance thresholds
    this.upgradeThreshold = 55; // FPS above this to consider upgrading
    this.downgradeThreshold = 40; // FPS below this to downgrade
    
    // Track stats
    this.currentFPS = 60;
    this.avgFPS = 60;
  }
  
  update(fps) {
    this.currentFPS = fps;
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.historySize) {
      this.fpsHistory.shift();
    }
    
    // Calculate rolling average
    if (this.fpsHistory.length > 0) {
      this.avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    }
    
    // Cooldown check
    if (this.adjustCooldown > 0) {
      this.adjustCooldown -= 16; // Approximate frame time
      return;
    }
    
    // Auto-adjust
    if (this.autoAdjust) {
      if (this.avgFPS < this.downgradeThreshold && this.currentPreset !== 'LOW') {
        this._downgrade();
      } else if (this.avgFPS > this.upgradeThreshold && this.currentPreset !== 'HIGH') {
        this._upgrade();
      }
    }
  }
  
  _downgrade() {
    const order = ['HIGH', 'MEDIUM', 'LOW'];
    const idx = order.indexOf(this.currentPreset);
    if (idx < order.length - 1) {
      this.currentPreset = order[idx + 1];
      this.settings = { ...QUALITY_PRESETS[this.currentPreset] };
      this.adjustCooldown = this.cooldownDuration;
      console.log(`[QualityManager] Downgraded to ${this.currentPreset}`);
    }
  }
  
  _upgrade() {
    const order = ['LOW', 'MEDIUM', 'HIGH'];
    const idx = order.indexOf(this.currentPreset);
    if (idx > 0) {
      this.currentPreset = order[idx - 1];
      this.settings = { ...QUALITY_PRESETS[this.currentPreset] };
      this.adjustCooldown = this.cooldownDuration;
      console.log(`[QualityManager] Upgraded to ${this.currentPreset}`);
    }
  }
  
  setPreset(preset) {
    if (QUALITY_PRESETS[preset]) {
      this.currentPreset = preset;
      this.settings = { ...QUALITY_PRESETS[preset] };
      console.log(`[QualityManager] Set preset to ${preset}`);
    }
  }
  
  getSetting(key) {
    return this.settings[key];
  }
  
  getAllSettings() {
    return { ...this.settings, preset: this.currentPreset, fps: Math.round(this.avgFPS) };
  }
}