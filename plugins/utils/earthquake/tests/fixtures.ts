/** Synthetic feed bodies and a URL-routed fake fetch. No real network. */
import { vi } from 'vitest';
import type { FetchLike } from '../src/http.js';

/** 2026-10-20 12:00:00 UTC */
export const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

export const MIRROR_URL = 'https://api.wolfx.jp/cenc_eqlist.json';
export const OFFICIAL_URL = 'https://ceic.ac.cn/data/data.json';
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

/** Formats epoch ms as CENC's Beijing-time text. */
export function beijingText(epochMs: number): string {
  const shifted = new Date(epochMs + 8 * 60 * 60 * 1_000);
  return shifted.toISOString().slice(0, 19).replace('T', ' ');
}

export interface QuakeSpec {
  readonly id: string;
  readonly time: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly magnitude: number;
  readonly location: string;
  readonly depth?: number;
}

export function officialBody(quakes: readonly QuakeSpec[]): string {
  return JSON.stringify(quakes.map((quake) => ({
    id: quake.id,
    time: beijingText(quake.time),
    latitude: quake.latitude,
    longitude: quake.longitude,
    depth: quake.depth ?? 10,
    magnitude: quake.magnitude,
    location: quake.location,
  })));
}

export function mirrorBody(quakes: readonly QuakeSpec[]): string {
  const entries = quakes.map((quake, index) => [`No${index + 1}`, {
    type: 'reviewed',
    EventID: quake.id,
    time: beijingText(quake.time),
    location: quake.location,
    magnitude: quake.magnitude.toFixed(1),
    depth: String(quake.depth ?? 10),
    latitude: quake.latitude.toFixed(2),
    longitude: quake.longitude.toFixed(2),
  }]);
  return JSON.stringify(Object.fromEntries(entries));
}

export function usgsBody(quakes: readonly QuakeSpec[], extraFeatures: readonly unknown[] = []): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    metadata: { generated: NOW, count: quakes.length },
    features: [
      ...quakes.map((quake) => ({
        type: 'Feature',
        id: quake.id,
        properties: {
          mag: quake.magnitude,
          place: quake.location,
          time: quake.time,
          type: 'earthquake',
          url: `https://earthquake.usgs.gov/earthquakes/eventpage/${quake.id}`,
        },
        geometry: { type: 'Point', coordinates: [quake.longitude, quake.latitude, quake.depth ?? 10] },
      })),
      ...extraFeatures,
    ],
  });
}

export function jsonResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

export function statusResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : 'error', { status, headers });
}

export type Route = (init?: RequestInit) => Response | Promise<Response>;

/** Fake fetch dispatching on exact URL; unknown URLs reject like a DNS failure. */
export function createRoutedFetch(routes: Record<string, Route>) {
  return vi.fn<FetchLike>(async (url, init) => {
    const route = routes[url];
    if (!route) throw new TypeError(`fetch failed: no route for ${url}`);
    return route(init);
  });
}

export const noSleep = vi.fn(async () => undefined);

/** A Sichuan quake as seen by CENC (two mirror ids) and USGS (mb, ~0.9 higher). */
export const SICHUAN_CENC: QuakeSpec = {
  id: 'CD.20261020195708.1',
  time: NOW - 10 * 60_000,
  latitude: 31.9,
  longitude: 104.46,
  magnitude: 5.1,
  location: '四川绵阳市北川县',
};
export const SICHUAN_MIRROR: QuakeSpec = { ...SICHUAN_CENC, id: 'AU.20261020195710.6' };
export const SICHUAN_USGS: QuakeSpec = {
  id: 'us7000test1',
  time: SICHUAN_CENC.time + 300,
  latitude: 31.948,
  longitude: 104.4577,
  magnitude: 5.9,
  location: '31 km NW of Jiangyou, China',
};
export const JAPAN_USGS: QuakeSpec = {
  id: 'us7000test2',
  time: NOW - 20 * 60_000,
  latitude: 38.3,
  longitude: 142.4,
  magnitude: 6.2,
  location: 'off the east coast of Honshu, Japan',
};
export const SMALL_XINJIANG_CENC: QuakeSpec = {
  id: 'CD.20261020190000.2',
  time: NOW - 30 * 60_000,
  latitude: 40.85,
  longitude: 84.15,
  magnitude: 3.2,
  location: '新疆巴音郭楞州尉犁县',
};
