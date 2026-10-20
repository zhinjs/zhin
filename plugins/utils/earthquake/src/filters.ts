/**
 * Magnitude and region filters shared by queries and subscriptions.
 *
 * A region is matched against every merged report's location text, so both the
 * Chinese CENC wording ("四川宜宾市珙县") and the English USGS wording
 * ("Hualien City, Taiwan") work. Matching is a case-insensitive substring test.
 *
 * `中国` / `国内` is a preset: CENC locations that start with a province-level
 * name, plus USGS places mentioning China or Taiwan.
 */
import type { EarthquakeEvent, SourceEarthquake } from './types.js';

export const CHINA_REGION_ALIASES = Object.freeze(['中国', '国内', 'china']);

/** Province-level divisions, in the short form CENC uses as a location prefix. */
const CHINA_PROVINCE_PREFIXES = Object.freeze([
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆', '台湾',
  '香港', '澳门',
]);

const CHINA_ENGLISH_MARKERS = Object.freeze(['china', 'taiwan']);

export function normalizeRegion(region: string): string {
  return region.trim().toLowerCase();
}

function isChinaReport(report: SourceEarthquake): boolean {
  const location = report.location.trim();
  if (CHINA_PROVINCE_PREFIXES.some((prefix) => location.startsWith(prefix))) {
    return true;
  }
  const lower = location.toLowerCase();
  return CHINA_ENGLISH_MARKERS.some((marker) => lower.includes(marker));
}

function reportMatchesRegion(report: SourceEarthquake, normalizedRegion: string): boolean {
  if (CHINA_REGION_ALIASES.includes(normalizedRegion)) {
    return isChinaReport(report);
  }
  return report.location.toLowerCase().includes(normalizedRegion);
}

/** True when any report of the event matches any region; an empty list matches everything. */
export function matchesRegions(event: EarthquakeEvent, regions: readonly string[]): boolean {
  const normalized = regions.map(normalizeRegion).filter((region) => region.length > 0);
  if (normalized.length === 0) return true;
  return event.reports.some((report) => normalized.some((region) => reportMatchesRegion(report, region)));
}

/**
 * Uses the largest reported magnitude so a quake reported as M5.0 by one source
 * and M4.8 by another still reaches a "5 级以上" subscriber.
 */
export function eventMagnitude(event: EarthquakeEvent): number {
  return Math.max(...event.reports.map((report) => report.magnitude));
}

export interface EventFilter {
  readonly minMagnitude: number;
  readonly regions: readonly string[];
}

export function matchesFilter(event: EarthquakeEvent, filter: EventFilter): boolean {
  if (eventMagnitude(event) < filter.minMagnitude) return false;
  return matchesRegions(event, filter.regions);
}
