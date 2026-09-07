import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NativeDevelopmentModuleRuntime, RootRuntime, supportsNativeTypeScript } from '@zhin.js/runtime';
import { ImRuntime } from 'zhin.js/core/runtime';
import { SelfDeliveryProject, selfDeliveryProjectToken } from '@zhin.js/agent/runtime';
import { rootPluginId } from 'zhin.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('self-delivery Plugin Runtime', () => {
  it.skipIf(!supportsNativeTypeScript())('starts a real Root with a fail-closed doctor and disposes', async () => {
    const im = new ImRuntime();
    const runtime = new RootRuntime({ projectRoot,
      modules: new NativeDevelopmentModuleRuntime({ projectRoot, watch: false }),
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: { plugin: { stateDirectory: './.zhin/self-delivery-issues', terminal: { interactive: false } } },
      installResources: ({ resources }) => im.install(resources),
    });
    im.attach(runtime.snapshots);
    try {
      const snapshot = await runtime.start();
      const service = snapshot.resources.get(rootPluginId())?.get(selfDeliveryProjectToken.id);
      if (!(service instanceof SelfDeliveryProject)) throw new Error('Missing self-delivery Resource');
      expect(await service.doctor()).toMatchObject({ configured: false, ready: false });
      await expect(service.select({ identity: 'alice', issueNumber: 1, acceptanceCriteria: ['test'] })).rejects.toThrow('not configured');
    } finally { await runtime.stop(); }
  });
});
