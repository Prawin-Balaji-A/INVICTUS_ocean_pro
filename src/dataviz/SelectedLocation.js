/**
 * SelectedLocation — the single shared bridge between the globe entry point and
 * the existing ocean / real-data pipeline.
 *
 * It holds ONE geographic coordinate the user picked on the 3D Earth:
 *
 *     { latitude, longitude, source, timestamp }
 *
 * The globe writes it (from real sphere-intersection math — never hardcoded),
 * the ocean reads it to centre the scene and to seed the INCOIS Argo region
 * query. Keeping this in one observable singleton means lat/lon logic is not
 * duplicated: the globe owns globe↔lat/lon (GlobeCoordinateTransform), the ocean
 * owns lat/lon↔world (GeoTransform), and this object is the geographic hand-off
 * in between.
 *
 * No scientific data lives here — only the chosen coordinate.
 */
export class SelectedLocation {
  constructor() {
    this._loc = null;         // null until the user picks a point
    this._subs = new Set();
  }

  /** Current selection, or null if nothing has been picked yet. */
  get() {
    return this._loc;
  }

  /**
   * Record a picked location. Ignores non-finite coordinates rather than
   * storing junk. Notifies subscribers with the new (immutable) value.
   */
  set(loc) {
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
    this._loc = {
      latitude: loc.latitude,
      longitude: loc.longitude,
      source: loc.source || 'globe',
      timestamp: loc.timestamp || Date.now(),
    };
    this._emit();
  }

  /** Clear the selection (notifies with null). */
  clear() {
    this._loc = null;
    this._emit();
  }

  /**
   * Subscribe to changes. Fires immediately with the current value (if any) so
   * late subscribers stay in sync. Returns an unsubscribe function.
   */
  subscribe(fn) {
    this._subs.add(fn);
    if (this._loc) { try { fn(this._loc); } catch (_) {} }
    return () => this._subs.delete(fn);
  }

  _emit() {
    for (const fn of this._subs) {
      try { fn(this._loc); } catch (_) {}
    }
  }
}

// Shared instance used by both the globe and the dataviz layer.
export const selectedLocation = new SelectedLocation();
