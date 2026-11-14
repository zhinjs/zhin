import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));

import { cachedRegistryLookup, npmRegistryLookup, parseNpmViewRelease } from '../src/utils/registry-version.js';

beforeEach(() => execFileSync.mockReset());

describe('registry version lookup', () => {
  it('parses npm view output for a tag, a single field and a range', () => {
    expect(parseNpmViewRelease('{"version":"1.3.0","dependencies":{"@zhin.js/core":"^1.3.0","x":1}}'))
      .toEqual({ version: '1.3.0', dependencies: { '@zhin.js/core': '^1.3.0' } });
    expect(parseNpmViewRelease('"1.3.0"')).toEqual({ version: '1.3.0', dependencies: {} });
    expect(parseNpmViewRelease('[{"version":"1.2.0"},{"version":"1.2.1"}]')).toEqual({ version: '1.2.1', dependencies: {} });
    expect(parseNpmViewRelease('"latest"')).toBeUndefined();
    expect(parseNpmViewRelease('not json')).toBeUndefined();
    expect(parseNpmViewRelease('')).toBeUndefined();
  });

  it('asks npm for the release and returns undefined when npm fails', () => {
    execFileSync.mockReturnValueOnce('{"version":"1.3.0"}');
    expect(npmRegistryLookup('zhin.js')).toEqual({ version: '1.3.0', dependencies: {} });
    expect(execFileSync.mock.calls[0]![1]).toEqual(['view', 'zhin.js@latest', 'version', 'dependencies', '--json']);
    execFileSync.mockImplementationOnce(() => { throw new Error('E404'); });
    expect(npmRegistryLookup('@zhin.js/missing', '1.0.0')).toBeUndefined();
  });

  it('queries each package once per run', () => {
    const lookup = vi.fn(() => ({ version: '1.0.0', dependencies: {} }));
    const cached = cachedRegistryLookup(lookup);
    cached('a'); cached('a'); cached('a', '1.0.0');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
