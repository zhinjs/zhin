import type { EarthquakeSourceId } from './config.js';

/** One earthquake as reported by a single source, normalised to SI-ish units. */
export interface SourceEarthquake {
  readonly source: EarthquakeSourceId;
  /** Source-scoped id, stable across polls. */
  readonly id: string;
  /** Origin time, epoch milliseconds (UTC). */
  readonly time: number;
  readonly latitude: number;
  readonly longitude: number;
  /** Hypocentre depth in kilometres; undefined when the source omits it. */
  readonly depthKm?: number;
  readonly magnitude: number;
  /** Human-readable place as published by the source. */
  readonly location: string;
  readonly url?: string;
}

/**
 * The same physical event after cross-source merging.
 * The primary report comes from the most preferred source that saw the event.
 */
export interface EarthquakeEvent {
  readonly primary: SourceEarthquake;
  /** Every report merged into this event, primary first. */
  readonly reports: readonly SourceEarthquake[];
}

/** Per-source outcome of one fetch round. */
export interface SourceOutcome {
  readonly source: EarthquakeSourceId;
  readonly ok: boolean;
  /** True when the source was skipped because it is cooling down after failures. */
  readonly skipped?: boolean;
  readonly error?: string;
  readonly eventCount: number;
}
