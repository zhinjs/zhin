import { describe, expect, it, vi } from 'vitest';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { defineAgentTool, ToolIndex, toolFeatureId } from '@zhin.js/tool';
import { CapabilityIngress } from '../../src/plugin-runtime/capability-ingress.js';
import { createDeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';
import type { TurnAccessContext } from '../../src/turn/turn-ingress.js';

function fixture(restricted = false) {
  const owner = rootPluginId();
  const ready = vi.fn(({ sessionKey }: { sessionKey: string }) => sessionKey !== 'icqq:bot-a:group:scene');
  const slots = ['resident', 'deferred', 'loaded'].map(name => createCapabilitySlot({
    owner, feature: toolFeatureId, localName: name, source: `/tools/${name}/index.ts`,
    definition: defineAgentTool({ description: `${name} sticker`, isAvailable: ready,
      alwaysLoaded: name === 'resident', execute: () => 'sticker' }),
  }));
  const ordinary = createCapabilitySlot({ owner, feature: toolFeatureId, localName: 'ordinary',
    source: '/tools/ordinary/index.ts', definition: defineAgentTool({ description: 'ordinary', execute: () => 'ok' }) });
  const inaccessible = restricted ? [
    { localName: 'wrong-platform', platforms: ['telegram'] },
    { localName: 'permission-denied', permissions: ['role(master)'] },
  ].map(({ localName, ...access }) => createCapabilitySlot({ owner, feature: toolFeatureId,
    localName, source: `/tools/${localName}/index.ts`, definition: defineAgentTool({
      description: 'Restricted sticker', ...access,
      isAvailable: () => { throw new Error('Inaccessible eligibility must not run'); }, execute: () => 'no',
    }),
  })) : [];
  const all = [...slots, ordinary, ...inaccessible];
  const base: RuntimeSnapshot = {
    generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map(),
    capabilities: new Map(all.map(slot => [slot.id, slot])), projections: new Map(),
  };
  return { owner, ready, snapshot: { ...base, projections: new Map([[toolFeatureId, new ToolIndex(all, base)]]) } };
}

function turn(sessionKey: string): TurnAccessContext {
  return {
    origin: { kind: 'im', platform: 'icqq', endpoint: sessionKey.includes('bot-a') ? 'bot-a' : 'bot-b', scope: 'group', sceneId: 'scene' },
    principal: { subjectId: 'member', roles: ['user'] },
    policy: { permissions: [], unattended: false }, session: { key: sessionKey },
  };
}

describe('Tool availability projection', () => {
  it('filters cooldown tools before resident, persisted loads, discovery and load_tool are built', async () => {
    const { owner, snapshot, ready } = fixture();
    const ingress = new CapabilityIngress();
    const capabilities = await ingress.read(snapshot, owner, () => true, turn('icqq:bot-a:group:scene'));
    expect(capabilities.tools.map(tool => tool.name)).toEqual(['ordinary']);
    expect(ready).toHaveBeenCalledTimes(3);
    expect(ready).toHaveBeenCalledWith({ sessionKey: 'icqq:bot-a:group:scene',
      origin: turn('icqq:bot-a:group:scene').origin });
    const plan = createDeferredCapabilityPlan({ capabilities,
      sessionSnapshot: { loadedSkills: [], loadedTools: { loaded: 1 } },
      config: { deferredTools: { alwaysLoadedTools: ['resident'] } }, persistSnapshot: async () => undefined,
    });
    for (const name of ['resident', 'deferred', 'loaded']) {
      expect(plan.allTools.some(tool => tool.name === name)).toBe(false);
      expect(plan.resolvedTools.some(tool => tool.name === name)).toBe(false);
      expect(plan.controller.loadedToolNames()).not.toContain(name);
      expect(await plan.controller.load(name)).toBe(false);
      const load = plan.capabilities.find(tool => tool.name === 'load_tool')!;
      const result = await load.execute({ name }, { signal: new AbortController().signal } as never);
      expect(String(result)).toContain('not found');
    }
    const discover = plan.capabilities.find(tool => tool.name === 'discover')!;
    expect(String(await discover.execute({ query: 'sticker', kind: 'tool' }, { signal: new AbortController().signal } as never))).not.toMatch(/resident|deferred|loaded/);
    const otherAccount = await ingress.read(snapshot, owner, () => true, turn('icqq:bot-b:group:scene'));
    expect(otherAccount.tools.map(tool => tool.name)).toEqual(['deferred', 'loaded', 'ordinary', 'resident']);
  });

  it('keeps static queries compatible and propagates predicate errors instead of reporting absence', async () => {
    const { owner, snapshot, ready } = fixture();
    const ingress = new CapabilityIngress();
    expect((await ingress.read(snapshot, owner)).tools).toHaveLength(4);
    expect(ready).not.toHaveBeenCalled();
    ready.mockImplementation(() => { throw new Error('cooldown state unavailable'); });
    await expect(ingress.read(snapshot, owner, () => true, turn('icqq:bot-a:group:scene')))
      .rejects.toThrow('cooldown state unavailable');
  });

  it('checks platform and permissions before reading plugin eligibility', async () => {
    const { owner, snapshot } = fixture(true);
    const capabilities = await new CapabilityIngress().read(snapshot, owner, () => true, turn('icqq:bot-a:group:scene'));
    expect(capabilities.tools.map(tool => tool.name)).toEqual(['ordinary']);
  });
});
