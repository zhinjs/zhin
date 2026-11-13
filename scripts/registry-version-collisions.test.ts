import {
  compareVersions,
  findLocalCollisions,
  findPlannedCollisions,
  registryUrl,
  suggestFreeVersion,
} from './registry-version-collisions.mjs';

// Registry state at the 1.2 release: core and agent had old-architecture 1.2.x+ versions above `latest`.
const registry: Record<string, { versions: string[]; latest: string } | null> = {
  '@zhin.js/core': { versions: ['1.1.59', '1.1.60', '1.2.0', '1.2.1', '1.3.0', '1.5.16'], latest: '1.1.60' },
  '@zhin.js/agent': { versions: ['1.1.51', '1.2.0', '1.2.1'], latest: '1.1.51' },
  'zhin.js': { versions: ['1.1.25', '1.1.26'], latest: '1.1.26' },
  '@zhin.js/new-package': null,
};
const lookup = async (name: string) => registry[name] ?? null;

describe('registry version collisions', () => {
  it('flags planned versions npm already has and suggests the first free minor', async () => {
    const hits = await findPlannedCollisions([
      { name: '@zhin.js/core', oldVersion: '1.1.60', newVersion: '1.2.0' },
      { name: '@zhin.js/agent', oldVersion: '1.2.1', newVersion: '1.3.0' },
      { name: 'zhin.js', oldVersion: '1.1.26', newVersion: '1.1.27' },
      { name: '@zhin.js/new-package', oldVersion: '0.0.0', newVersion: '1.0.0' },
    ], lookup);
    expect(hits).toEqual([expect.objectContaining({ name: '@zhin.js/core', newVersion: '1.2.0', suggestion: '1.6.0' })]);
  });

  it('flags a local version npm has from another line (above latest), not a version this repo already published', async () => {
    const hits = await findLocalCollisions([
      { name: '@zhin.js/core', version: '1.2.0' },
      { name: '@zhin.js/agent', version: '1.3.0' },
      { name: 'zhin.js', version: '1.1.26' },
      { name: '@zhin.js/new-package', version: '1.0.0' },
    ], lookup);
    expect(hits).toEqual([expect.objectContaining({ name: '@zhin.js/core', version: '1.2.0', latest: '1.1.60', suggestion: '1.6.0' })]);
  });

  it('builds registry URLs that keep the scope and encode the rest', () => {
    expect(registryUrl('@zhin.js/core')).toBe('https://registry.npmjs.org/@zhin.js%2Fcore');
    expect(registryUrl('zhin.js')).toBe('https://registry.npmjs.org/zhin.js');
    expect(registryUrl('@a/b@c')).toBe('https://registry.npmjs.org/@a%2Fb%40c');
  });

  it('compares and suggests by x.y.z', () => {
    expect(compareVersions('1.2.0', '1.1.60')).toBeGreaterThan(0);
    expect(compareVersions('1.1.26', '1.1.26')).toBe(0);
    expect(suggestFreeVersion('1.2.0', ['1.2.0', '1.2.1'])).toBe('1.3.0');
    expect(suggestFreeVersion('1.2.0', ['1.5.16', '2.0.0'])).toBe('1.6.0');
  });
});
