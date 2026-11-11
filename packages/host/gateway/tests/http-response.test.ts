import { normalizeBase } from '../src/http-response.js';

describe('normalizeBase', () => {
  it('trims trailing slashes and falls back to /api', () => {
    expect(normalizeBase('/api/')).toBe('/api');
    expect(normalizeBase('/x///')).toBe('/x');
    expect(normalizeBase('/')).toBe('/api');
    expect(normalizeBase('api')).toBe('/api');
  });

  it('stays linear on long runs of slashes', () => {
    const value = `/${'/'.repeat(100_000)}x${'/'.repeat(100_000)}`;
    const started = performance.now();
    expect(normalizeBase(value).endsWith('x')).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
