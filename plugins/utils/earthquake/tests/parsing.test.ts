import { describe, expect, it } from 'vitest';
import { parseBeijingTime, parseCencFeed } from '../src/sources/cenc.js';
import { parseUsgsFeed } from '../src/sources/usgs.js';
import { JAPAN_USGS, mirrorBody, officialBody, SICHUAN_CENC, usgsBody } from './fixtures.js';

describe('CENC parsing', () => {
  it('parses Beijing time without an offset as UTC+8', () => {
    expect(parseBeijingTime('2026-10-20 20:00:00')).toBe(Date.UTC(2026, 9, 20, 12, 0, 0));
    expect(parseBeijingTime('2026-10-20T20:00:00')).toBe(Date.UTC(2026, 9, 20, 12, 0, 0));
    expect(parseBeijingTime('2026-10-20T12:00:00Z')).toBe(Date.UTC(2026, 9, 20, 12, 0, 0));
    expect(parseBeijingTime('2026-02-31 10:00:00')).toBeUndefined();
    expect(parseBeijingTime('yesterday')).toBeUndefined();
  });

  it('parses the official array shape', () => {
    const [event] = parseCencFeed(officialBody([SICHUAN_CENC]));
    expect(event).toMatchObject({
      source: 'cenc',
      id: SICHUAN_CENC.id,
      time: SICHUAN_CENC.time,
      latitude: 31.9,
      longitude: 104.46,
      depthKm: 10,
      magnitude: 5.1,
      location: '四川绵阳市北川县',
    });
  });

  it('parses the mirror object shape with numeric strings', () => {
    const events = parseCencFeed(mirrorBody([SICHUAN_CENC]));
    expect(events).toHaveLength(1);
    expect(events[0]!.magnitude).toBe(5.1);
    expect(events[0]!.time).toBe(SICHUAN_CENC.time);
  });

  it('accepts a { data: [...] } envelope', () => {
    const body = JSON.stringify({ data: JSON.parse(officialBody([SICHUAN_CENC])) });
    expect(parseCencFeed(body)).toHaveLength(1);
  });

  it('skips malformed rows but keeps good ones', () => {
    const good = JSON.parse(officialBody([SICHUAN_CENC]))[0];
    const body = JSON.stringify([
      good,
      null,
      'garbage',
      { ...good, id: 'bad-lat', latitude: 123 },
      { ...good, id: 'bad-mag', magnitude: 'big' },
      { ...good, id: 'bad-time', time: 'soon' },
      { ...good, id: 'no-location', location: '' },
    ]);
    const events = parseCencFeed(body);
    expect(events.map((event) => event.id)).toEqual([SICHUAN_CENC.id]);
  });

  it('fails loudly on non-JSON, unknown shapes and fully unreadable lists', () => {
    expect(() => parseCencFeed('<html>502</html>')).toThrow('不是有效 JSON');
    expect(() => parseCencFeed('{"hello":1}')).toThrow('格式无法识别');
    expect(() => parseCencFeed('[{"id":1},{"id":2}]')).toThrow('全部无法解析');
    expect(parseCencFeed('[]')).toEqual([]);
  });
});

describe('USGS parsing', () => {
  it('parses earthquake features and drops blasts', () => {
    const blast = {
      type: 'Feature',
      id: 'blast1',
      properties: { mag: 2.6, place: 'quarry', time: JAPAN_USGS.time, type: 'quarry blast' },
      geometry: { type: 'Point', coordinates: [0, 0, 0] },
    };
    const events = parseUsgsFeed(usgsBody([JAPAN_USGS], [blast]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'usgs',
      id: JAPAN_USGS.id,
      magnitude: 6.2,
      latitude: 38.3,
      longitude: 142.4,
      url: `https://earthquake.usgs.gov/earthquakes/eventpage/${JAPAN_USGS.id}`,
    });
  });

  it('skips features with missing geometry or magnitude', () => {
    const broken = [
      { type: 'Feature', id: 'x1', properties: { mag: null, place: 'p', time: 1, type: 'earthquake' }, geometry: { coordinates: [1, 1] } },
      { type: 'Feature', id: 'x2', properties: { mag: 3, place: 'p', time: 1, type: 'earthquake' } },
    ];
    expect(parseUsgsFeed(usgsBody([JAPAN_USGS], broken)).map((event) => event.id)).toEqual([JAPAN_USGS.id]);
  });

  it('fails loudly on unknown shapes', () => {
    expect(() => parseUsgsFeed('nope')).toThrow('不是有效 JSON');
    expect(() => parseUsgsFeed('{"type":"FeatureCollection"}')).toThrow('格式无法识别');
    expect(() => parseUsgsFeed(usgsBody([], [{ type: 'Feature', properties: { type: 'earthquake' } }]))).toThrow('全部无法解析');
  });
});
