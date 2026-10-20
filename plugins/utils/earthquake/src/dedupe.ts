/**
 * Cross-source de-duplication.
 *
 * CENC and USGS report the same physical event with different ids, slightly
 * different origin times, epicentres and magnitude types (Ms vs Mw). Two reports
 * are the same event when all three tolerances hold:
 *
 * - origin time within `timeToleranceMs`   (default 60 s)
 * - epicentres within `distanceToleranceKm` (default 100 km, great-circle)
 * - magnitudes within `magnitudeTolerance`  (default 1.0; CENC M vs USGS mb often differ by ~1)
 *
 * Reports from the same source match when their ids match, or when origin
 * times are within `sameSourceTimeToleranceMs` (default 5 s) and epicentres
 * within `sameSourceDistanceKm` (default 50 km). The second rule covers CENC
 * mirrors that assign different ids to one event, and revised reports.
 */
import type { EarthquakeSourceId } from './config.js';
import type { EarthquakeEvent, SourceEarthquake } from './types.js';

export interface DedupeTolerance {
  readonly timeToleranceMs: number;
  readonly distanceToleranceKm: number;
  readonly magnitudeTolerance: number;
  readonly sameSourceTimeToleranceMs: number;
  readonly sameSourceDistanceKm: number;
}

export const DEFAULT_DEDUPE_TOLERANCE: DedupeTolerance = Object.freeze({
  timeToleranceMs: 60_000,
  distanceToleranceKm: 100,
  magnitudeTolerance: 1.0,
  sameSourceTimeToleranceMs: 5_000,
  sameSourceDistanceKm: 50,
});

const EARTH_RADIUS_KM = 6_371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance (haversine) in kilometres. */
export function distanceKm(
  a: { readonly latitude: number; readonly longitude: number },
  b: { readonly latitude: number; readonly longitude: number },
): number {
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const h = sinLatitude * sinLatitude
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * sinLongitude * sinLongitude;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when two reports describe the same physical event. */
export function isSameEvent(
  a: SourceEarthquake,
  b: SourceEarthquake,
  tolerance: DedupeTolerance = DEFAULT_DEDUPE_TOLERANCE,
): boolean {
  if (a.source === b.source) {
    if (a.id === b.id) return true;
    if (Math.abs(a.time - b.time) > tolerance.sameSourceTimeToleranceMs) return false;
    return distanceKm(a, b) <= tolerance.sameSourceDistanceKm;
  }
  if (Math.abs(a.time - b.time) > tolerance.timeToleranceMs) return false;
  if (Math.abs(a.magnitude - b.magnitude) > tolerance.magnitudeTolerance) return false;
  return distanceKm(a, b) <= tolerance.distanceToleranceKm;
}

function sourceRank(source: EarthquakeSourceId, preference: readonly EarthquakeSourceId[]): number {
  const index = preference.indexOf(source);
  return index === -1 ? preference.length : index;
}

/**
 * Merges reports into events. The primary report of each event is the one from
 * the most preferred source. Output is sorted newest first.
 */
export function mergeReports(
  reports: readonly SourceEarthquake[],
  preference: readonly EarthquakeSourceId[],
  tolerance: DedupeTolerance = DEFAULT_DEDUPE_TOLERANCE,
): EarthquakeEvent[] {
  // Visit preferred sources first so they become primaries.
  const ordered = [...reports].sort((left, right) => {
    const byRank = sourceRank(left.source, preference) - sourceRank(right.source, preference);
    if (byRank !== 0) return byRank;
    return right.time - left.time;
  });
  const groups: SourceEarthquake[][] = [];
  for (const report of ordered) {
    let placed = false;
    for (const group of groups) {
      const sameSourceMember = group.find((member) => member.source === report.source);
      if (sameSourceMember) {
        // One report per source per event: a match here is a duplicate, otherwise keep looking.
        if (isSameEvent(sameSourceMember, report, tolerance)) {
          placed = true;
          break;
        }
        continue;
      }
      if (isSameEvent(group[0]!, report, tolerance)) {
        group.push(report);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([report]);
    }
  }
  const events = groups.map((group) => ({ primary: group[0]!, reports: Object.freeze([...group]) }));
  events.sort((left, right) => right.primary.time - left.primary.time);
  return events;
}

/**
 * Remembers events that were already announced so the poller pushes each
 * physical event once, even when the second source reports it minutes later.
 * Bounded by count and age.
 */
export class SeenEventLog {
  readonly #entries: SourceEarthquake[] = [];
  readonly #maxEntries: number;
  readonly #maxAgeMs: number;
  readonly #tolerance: DedupeTolerance;

  constructor(options: {
    readonly maxEntries?: number;
    readonly maxAgeMs?: number;
    readonly tolerance?: DedupeTolerance;
  } = {}) {
    this.#maxEntries = options.maxEntries ?? 2_000;
    this.#maxAgeMs = options.maxAgeMs ?? 48 * 60 * 60_000;
    this.#tolerance = options.tolerance ?? DEFAULT_DEDUPE_TOLERANCE;
  }

  get size(): number {
    return this.#entries.length;
  }

  has(event: EarthquakeEvent): boolean {
    return event.reports.some((report) => this.#entries.some((seen) => isSameEvent(seen, report, this.#tolerance)));
  }

  /** Records every report of the event so later reports from either source match. */
  add(event: EarthquakeEvent): void {
    for (const report of event.reports) {
      const known = this.#entries.some((seen) => seen.source === report.source && seen.id === report.id);
      if (!known) this.#entries.push(report);
    }
  }

  prune(now: number): void {
    const oldest = now - this.#maxAgeMs;
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      if (this.#entries[index]!.time < oldest) this.#entries.splice(index, 1);
    }
    const overflow = this.#entries.length - this.#maxEntries;
    if (overflow > 0) {
      this.#entries.sort((left, right) => left.time - right.time);
      this.#entries.splice(0, overflow);
    }
  }
}
