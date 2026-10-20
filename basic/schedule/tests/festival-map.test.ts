import { describe, expect, it } from 'vitest';
import {
  isFestivalName,
  matchesFestivalFilter,
  normalizeFestivalKey,
} from '../src/utils/festival-map.js';

describe('festival-map', () => {
  it('isFestivalName recognizes official names', () => {
    expect(isFestivalName('春节')).toBe(true);
    expect(isFestivalName('非法')).toBe(false);
  });

  it('matchesFestivalFilter handles all and specific festivals', () => {
    expect(matchesFestivalFilter('国庆节', 'all')).toBe(true);
    expect(matchesFestivalFilter(undefined, 'all')).toBe(false);
    expect(matchesFestivalFilter(undefined, ['国庆节'])).toBe(false);
    expect(matchesFestivalFilter('国庆节', ['国庆节'])).toBe(true);
    expect(matchesFestivalFilter('春节', ['国庆节'])).toBe(false);
  });

  it('normalizeFestivalKey returns undefined for unknown', () => {
    expect(normalizeFestivalKey('春节')).toBe('春节');
    expect(normalizeFestivalKey('unknown')).toBeUndefined();
  });
});
