import { describe, expect, it } from 'vitest';
import {
  childPluginId, createCapabilitySlot, featureId, primaryConfigToken, rootPluginId,
  type PluginId, type PluginNodeSnapshot, type PrimaryConfig, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { defineAgentTool, ToolIndex, toolFeatureId } from '@zhin.js/tool';
import { CapabilityIngress, featureGate } from '../../src/plugin-runtime/capability-ingress.js';
import type { TurnAccessContext } from '../../src/turn/turn-ingress.js';

const root = rootPluginId();
const rss = childPluginId(root, 'rss');
const weather = childPluginId(root, 'weather');
const qq = childPluginId(root, 'qq');

function fixture(document: Record<string, unknown>): RuntimeSnapshot {
  const node = (id: PluginId, instanceKey: string, children: PluginId[] = []) =>
    ({ id, instanceKey, packageName: `@x/${instanceKey}`, packageRoot: `/x/${instanceKey}`, children }) as unknown as PluginNodeSnapshot;
  const slots = ([[rss, 'rss_fetch'], [weather, 'weather_now'], [root, 'host_tool']] as const).map(([owner, name]) => createCapabilitySlot({
    owner, feature: toolFeatureId, localName: name, source: `/tools/${name}/index.ts`,
    definition: defineAgentTool({ description: name, execute: () => name }),
  }));
  const primary: PrimaryConfig = { document, expanded: document, get: () => undefined };
  const base: RuntimeSnapshot = {
    generation: 1, root,
    tree: new Map([[root, node(root, 'root', [rss, weather, qq])], [rss, node(rss, 'rss')], [weather, node(weather, 'weather')], [qq, node(qq, 'qq')]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map([[primaryConfigToken.id, primary]])], [rss, new Map()], [weather, new Map()], [qq, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
  return { ...base, projections: new Map<ReturnType<typeof featureId>, unknown>([
    [toolFeatureId, new ToolIndex(slots, base)],
    [featureId('zhin.adapter'), { owner: () => qq, endpointEntry: (id: string) => ({ desired: { endpointId: id } }) }],
  ]) };
}

function turn(endpoint?: string): TurnAccessContext {
  return {
    origin: { kind: 'im', platform: 'qq', endpoint: endpoint ?? 'none', scope: 'group', sceneId: 'scene',
      ...(endpoint ? { conversation: { kind: 'group', id: 'scene', endpoint: { id: endpoint, adapter: 'qq' } } } : {}) },
    principal: { subjectId: 'member', roles: ['user'] },
    policy: { permissions: [], unattended: false }, session: { key: `qq:${endpoint}:group:scene` },
  } as unknown as TurnAccessContext;
}

const document = {
  configVersion: 2, plugins: { rss: '@x/rss', weather: '@x/weather', qq: '@x/qq' },
  rss: { overrides: { endpoints: { 'qq/news': { enabled: false } } } },
  weather: { overrides: { adapters: { qq: { enabled: false } } } },
};

describe('ADR 0050 tool disclosure gate', () => {
  it('hides tools of Plugins disabled for the conversation endpoint', async () => {
    const snapshot = fixture(document);
    const ingress = new CapabilityIngress();
    const names = async (endpoint?: string) => (await ingress.read({ snapshot, owner: root, isActive: () => true, turn: turn(endpoint) }))
      .tools.map(tool => tool.name).sort();
    expect(await names('news')).toEqual(['host_tool']);
    expect(await names('main')).toEqual(['host_tool', 'rss__rss_fetch']);
    // Turns without an endpoint (static queries, non-IM) are not gated.
    expect((await ingress.read({ snapshot, owner: root })).tools.map(tool => tool.name).sort()).toEqual(['host_tool', 'rss__rss_fetch', 'weather__weather_now']);
    expect(await names(undefined)).toEqual(['host_tool', 'rss__rss_fetch', 'weather__weather_now']);
  });

  it('exposes the owner predicate for other disclosure paths', () => {
    const snapshot = fixture(document);
    const gate = featureGate(snapshot, turn('news'));
    expect([rss, weather, root].map(owner => gate(owner))).toEqual([false, false, true]);
    expect(featureGate(snapshot, { ...turn('news'), origin: { kind: 'http', sessionId: 'x' } } as never)(rss)).toBe(true);
  });
});
