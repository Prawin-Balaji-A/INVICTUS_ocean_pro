/**
 * HistoricalSimulation — Controls historical ocean simulation playback.
 * 
 * Supports play/pause, timeline seeking, and speed multipliers.
 * Manages timestamp synchronization across ocean data layers.
 */
export class HistoricalSimulation {
  constructor(oceanData) {
    this.oceanData = oceanData;
    this.isPlaying = false;
    this.playbackSpeed = 1.0; // 1x, 5x, 10x, 60x
    this.startTime = new Date('2026-01-01T00:00:00Z').getTime();
    this.endTime = new Date('2026-01-31T23:59:59Z').getTime();
    this.currentTime = this.startTime;
    this.listeners = [];
  }

  play() {
    this.isPlaying = true;
    this._notify();
  }

  pause() {
    this.isPlaying = false;
    this._notify();
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  setSpeed(speed) {
    this.playbackSpeed = Math.max(0.1, Math.min(100, speed));
    this._notify();
  }

  setTime(timeMs) {
    this.currentTime = Math.max(this.startTime, Math.min(this.endTime, timeMs));
    this._notify();
  }

  setProgress(progress01) {
    const range = this.endTime - this.startTime;
    this.currentTime = this.startTime + range * Math.max(0, Math.min(1, progress01));
    this._notify();
  }

  getProgress() {
    return (this.currentTime - this.startTime) / (this.endTime - this.startTime);
  }

  getFormattedDate() {
    return new Date(this.currentTime).toUTCString();
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  _notify() {
    for (const cb of this.listeners) {
      cb({
        isPlaying: this.isPlaying,
        currentTime: this.currentTime,
        progress: this.getProgress(),
        formattedDate: this.getFormattedDate(),
        speed: this.playbackSpeed
      });
    }
  }

  update(dt) {
    if (!this.isPlaying) return;

    // Advance historical time (1 real second = 1 hour * speed by default)
    const simulatedDeltaMs = dt * 3600 * 1000 * this.playbackSpeed;
    this.currentTime += simulatedDeltaMs;

    if (this.currentTime >= this.endTime) {
      this.currentTime = this.startTime; // Loop
    }

    this._notify();
  }
}
