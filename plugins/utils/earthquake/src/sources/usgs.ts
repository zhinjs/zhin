/**
 * USGS real-time GeoJSON summary feeds.
 * Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 *
 * Only `properties.type === "earthquake"` features are kept (quarry blasts and
 * explosions are dropped). Features with missing or out-of-range fields are
 * skipped individually.
 */
import type { UsgsFeed } from '../config.js';
import type { SourceEarthquake } from '../types.js';
import {
  isPlausibleMagnitude,
  isRecord,
  isValidLatitude,
  isValidLongitude,
  toFiniteNumber,
  toTrimmedString,
} from './parse-helpers.js';

export function usgsFeedUrl(feed: UsgsFeed): string {
  return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;
}

/** Blasts, explosions and other non-earthquake events are not errors, just irrelevant. */
function isEarthquakeFeature(feature: unknown): boolean {
  if (!isRecord(feature) || !isRecord(feature.properties)) return true;
  const eventType = toTrimmedString(feature.properties.type);
  return eventType === undefined || eventType === 'earthquake';
}

function parseUsgsFeature(feature: unknown): SourceEarthquake | undefined {
  if (!isRecord(feature)) return undefined;
  const properties = feature.properties;
  const geometry = feature.geometry;
  if (!isRecord(properties) || !isRecord(geometry)) return undefined;
  const eventType = toTrimmedString(properties.type);
  if (eventType !== undefined && eventType !== 'earthquake') return undefined;
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return undefined;
  const longitude = toFiniteNumber(coordinates[0]);
  const latitude = toFiniteNumber(coordinates[1]);
  const depth = toFiniteNumber(coordinates[2]);
  const magnitude = toFiniteNumber(properties.mag);
  const time = toFiniteNumber(properties.time);
  const id = toTrimmedString(feature.id) ?? toTrimmedString(properties.code);
  const location = toTrimmedString(properties.place) ?? toTrimmedString(properties.title);
  if (!id || !location || time === undefined) return undefined;
  if (latitude === undefined || !isValidLatitude(latitude)) return undefined;
  if (longitude === undefined || !isValidLongitude(longitude)) return undefined;
  if (magnitude === undefined || !isPlausibleMagnitude(magnitude)) return undefined;
  const url = toTrimmedString(properties.url);
  return {
    source: 'usgs',
    id,
    time,
    latitude,
    longitude,
    depthKm: depth !== undefined && depth >= 0 ? depth : undefined,
    magnitude,
    location,
    url: url?.startsWith('https://') ? url : undefined,
  };
}

/** Parses a USGS GeoJSON FeatureCollection. Throws only when there is no feature list at all. */
export function parseUsgsFeed(body: string): SourceEarthquake[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error('USGS 返回的不是有效 JSON', { cause: error });
  }
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    throw new Error('USGS 返回的数据格式无法识别');
  }
  const events: SourceEarthquake[] = [];
  let earthquakeFeatures = 0;
  for (const feature of payload.features) {
    if (!isEarthquakeFeature(feature)) continue;
    earthquakeFeatures += 1;
    const event = parseUsgsFeature(feature);
    if (event) events.push(event);
  }
  if (earthquakeFeatures > 0 && events.length === 0) {
    // Every earthquake feature is unreadable: the schema probably changed.
    throw new Error('USGS 返回的记录全部无法解析');
  }
  return events;
}
