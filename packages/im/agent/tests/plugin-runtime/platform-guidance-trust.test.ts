import { describe, expect, it } from 'vitest';
import { adapterFeatureId } from '@zhin.js/core';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import {
  CapabilityIngress,
  isTrustedOfficialAdapterPackage,
} from '../../src/plugin-runtime/capability-ingress.js';

describe('ADR 0044 trusted official adapters', () => {
  it('trusts only the @zhin.js/ scope', () => {
    expect(isTrustedOfficialAdapterPackage('@zhin.js/adapter-icqq')).toBe(true);
    expect(isTrustedOfficialAdapterPackage('@evil/adapter-icqq')).toBe(false);
    expect(isTrustedOfficialAdapterPackage('zhin.js-adapter-x')).toBe(false);
    expect(isTrustedOfficialAdapterPackage(undefined)).toBe(false);
  });

  const owner = rootPluginId();
  const adapterPlugin = 'adapter-plugin' as PluginId;

  function snapshotWith(adapterPackage: string): RuntimeSnapshot {
    const node = (id: PluginId, packageName: string) => ({ id, instanceKey: String(id), packageName, packageRoot: '/x', children: [] });
    return {
      generation: 1,
      root: owner,
      tree: new Map([[owner, node(owner, '@test/root')], [adapterPlugin, node(adapterPlugin, adapterPackage)]]),
      config: new Map(),
      resources: new Map([[owner, new Map([[permissionHostToken.id, { check: () => true, checkAll: () => true }]])]]),
      capabilities: new Map(),
      projections: new Map([[adapterFeatureId, { $projection: 'zhin.adapter-index/1', owner: () => adapterPlugin }]]),
    } as unknown as RuntimeSnapshot;
  }

  const turn = {
    origin: { kind: 'im' as const, platform: 'icqq', endpoint: '7', scope: 'group' as const, sceneId: '100',
      conversation: { endpoint: { id: 'ep', adapter: 'icqq' }, kind: 'group', id: '100' } },
    principal: { subjectId: '2', roles: [] as string[] },
    policy: { permissions: [], unattended: false, network: { enabled: false } },
    input: {},
  };

  it('does not label an official adapter plugin owned by another plugin', async () => {
    const caps = await new CapabilityIngress().read(snapshotWith('@zhin.js/adapter-icqq'), owner, () => true, turn as never);
    expect(caps.platformGuidanceExternal).toBe(false);
  });

  it('keeps the external_content label for third-party adapter packages', async () => {
    const caps = await new CapabilityIngress().read(snapshotWith('some-community-adapter'), owner, () => true, turn as never);
    expect(caps.platformGuidanceExternal).toBe(true);
  });
});
