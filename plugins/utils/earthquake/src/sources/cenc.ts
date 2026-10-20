/**
 * China Earthquake Networks Center (中国地震台网中心, CENC) public catalogue feed.
 *
 * The public site https://www.cenc.ac.cn / https://ceic.ac.cn renders its
 * "最新地震" list from a static JSON array at `https://ceic.ac.cn/data/data.json`:
 *
 *   [{ "id": "CC.20261020145206.3", "time": "2026-10-20 14:41:20",
 *      "latitude": 37.8, "longitude": 95.65, "depth": 10,
 *      "magnitude": 4.6, "location": "青海海西州直辖区" }, ...]
 *
 * Times are Beijing time (UTC+8) without an offset. The feed is undocumented, so
 * parsing is deliberately tolerant: numeric strings are accepted, a wrapped
 * `{ data: [...] }` envelope is unwrapped, and invalid rows are skipped one by
 * one instead of failing the whole batch.
 */
import type { SourceEarthquake } from '../types.js';
import {
  isPlausibleMagnitude,
  isRecord,
  isValidLatitude,
  isValidLongitude,
  toFiniteNumber,
  toTrimmedString,
} from './parse-helpers.js';

export const CENC_FEED_URL = 'https://ceic.ac.cn/data/data.json';
export const CENC_HOME_URL = 'https://www.cenc.ac.cn/';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1_000;
const BEIJING_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/u;

/** Parses `YYYY-MM-DD HH:mm:ss` in Beijing time; also accepts ISO strings with an explicit offset. */
export function parseBeijingTime(value: string): number | undefined {
  const match = BEIJING_TIME_PATTERN.exec(value.trim());
  if (!match) {
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value.trim());
    if (!hasExplicitZone) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(utc);
  // Reject impossible dates such as 2026-02-31 instead of silently rolling over.
  if (roundTrip.getUTCDate() !== day || roundTrip.getUTCMonth() !== month - 1) {
    return undefined;
  }
  return utc - BEIJING_OFFSET_MS;
}

function extractRows(payload: unknown): readonly unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return [];
}

function parseCencRow(row: unknown): SourceEarthquake | undefined {
  if (!isRecord(row)) return undefined;
  const id = toTrimmedString(row.id);
  const timeText = toTrimmedString(row.time);
  const latitude = toFiniteNumber(row.latitude);
  const longitude = toFiniteNumber(row.longitude);
  const magnitude = toFiniteNumber(row.magnitude);
  const location = toTrimmedString(row.location);
  if (!id || !timeText || !location) return undefined;
  if (latitude === undefined || !isValidLatitude(latitude)) return undefined;
  if (longitude === undefined || !isValidLongitude(longitude)) return undefined;
  if (magnitude === undefined || !isPlausibleMagnitude(magnitude)) return undefined;
  const time = parseBeijingTime(timeText);
  if (time === undefined) return undefined;
  const depth = toFiniteNumber(row.depth);
  return {
    source: 'cenc',
    id,
    time,
    latitude,
    longitude,
    depthKm: depth !== undefined && depth >= 0 ? depth : undefined,
    magnitude,
    location,
  };
}

/** Parses the CENC feed body. Throws only when the body is not JSON or has no list at all. */
export function parseCencFeed(body: string): SourceEarthquake[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error('CENC 返回的不是有效 JSON', { cause: error });
  }
  const isList = Array.isArray(payload) || (isRecord(payload) && Array.isArray(payload.data));
  if (!isList) {
    throw new Error('CENC 返回的数据格式无法识别');
  }
  const rows = extractRows(payload);
  const events: SourceEarthquake[] = [];
  for (const row of rows) {
    const event = parseCencRow(row);
    if (event) events.push(event);
  }
  if (rows.length > 0 && events.length === 0) {
    // Every row is unreadable: the schema probably changed. Fail so callers fall back.
    throw new Error('CENC 返回的记录全部无法解析');
  }
  return events;
}
