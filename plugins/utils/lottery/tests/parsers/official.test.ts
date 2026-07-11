import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fetchFucaiDraws, fetchTicaiDraws } from '../../src/sync/fetch-official.js';

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures');

function mockFetch(fixtureName: string): typeof fetch {
  const body = fs.readFileSync(path.join(fixturesDir, fixtureName), 'utf8');
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    expect(url).toContain('?');
    if (url.includes('findDrawNotice')) {
      expect(url).toContain('systemType=PC');
      expect(url).toContain('pageNo=');
    }
    if (url.includes('getHistoryPageListV1')) {
      expect(url).toContain('gameNo=');
    }
    return {
      ok: true,
      json: async () => JSON.parse(body),
    } as Response;
  };
}

describe('fucai parsers', () => {
  it('parses kl8 draws via GET', async () => {
    const draws = await fetchFucaiDraws('kl8', 2, mockFetch('fucai-kl8.json'));
    expect(draws).toHaveLength(2);
    expect(draws[0]!.gameId).toBe('kl8');
    expect(draws[0]!.numbers.main).toHaveLength(20);
    expect(draws[0]!.issue).toBe('2024150');
  });

  it('parses ssq draws', async () => {
    const draws = await fetchFucaiDraws('ssq', 2, mockFetch('fucai-ssq.json'));
    expect(draws[0]!.numbers.red).toHaveLength(6);
    expect(draws[0]!.numbers.blue).toHaveLength(1);
  });

  it('parses fc3d draws', async () => {
    const draws = await fetchFucaiDraws('3d', 2, mockFetch('fucai-fc3d.json'));
    expect(draws[0]!.gameId).toBe('fc3d');
    expect(draws[0]!.numbers.digits).toEqual([3, 8, 1]);
  });
});

describe('ticai parsers', () => {
  it('parses dlt draws', async () => {
    const draws = await fetchTicaiDraws('85', 2, mockFetch('ticai-dlt.json'));
    expect(draws[0]!.gameId).toBe('dlt');
    expect(draws[0]!.numbers.front).toHaveLength(5);
    expect(draws[0]!.numbers.back).toHaveLength(2);
  });

  it('parses pl3 draws', async () => {
    const draws = await fetchTicaiDraws('35', 2, mockFetch('ticai-pl3.json'));
    expect(draws[0]!.numbers.digits).toEqual([5, 2, 9]);
  });

  it('parses pl5 draws', async () => {
    const draws = await fetchTicaiDraws('350133', 2, mockFetch('ticai-pl5.json'));
    expect(draws[0]!.numbers.digits).toHaveLength(5);
  });
});
