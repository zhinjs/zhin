import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOST_CONFIG_KEYS, SourceOwnershipIndex } from '@zhin.js/runtime';
import type { PluginId } from '@zhin.js/plugin-runtime';
import { createSelfChangeImpactPort } from '../../../src/plugin-runtime/agent/module.js';

describe('createSelfChangeImpactPort', () => {
  it('is absent without a source ownership reader', () => {
    expect(createSelfChangeImpactPort(undefined)).toBeUndefined();
  });

  it('plans with the live ownership index and Console host config keys', () => {
    const root = '/project';
    let index = SourceOwnershipIndex.empty();
    const port = createSelfChangeImpactPort(() => index)!;
    expect(port.hostConfigKeys).toBe(HOST_CONFIG_KEYS);
    expect(port.planFiles([join(root, 'commands', 'ping.ts')])).toMatchObject({ kind: 'none' });

    // Read at call time: a later generation's ownership is used, not the one at install.
    index = SourceOwnershipIndex.empty();
    index.addPackageRoot(root, 'root' as PluginId);
    expect(port.planFiles([join(root, 'commands', 'ping.ts')])).toMatchObject({
      kind: 'generation',
      fallbacks: [{ owners: ['root'] }],
    });
    index.add({ source: join(root, 'plugin.ts'), role: 'plugin', owner: 'root' as PluginId });
    expect(port.planFiles([join(root, 'plugin.ts')])).toMatchObject({ kind: 'process' });
  });
});
