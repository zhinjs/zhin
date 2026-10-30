import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterIndex, Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { childPluginId, createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { Message } from '@zhin.js/core/runtime';
import { createEndpointRoleResolver, createSenderEnricher } from '../../src/plugin-runtime/sender-enrichment.js';
import { resolveOwnerForRuntimeMessage, resolveTrustedForRuntimeMessage } from '../../src/plugin-runtime/agent/turn/request.js';

const document = (configs: Record<string, unknown>) => ({ configVersion: 2 as const,
  plugins: Object.fromEntries(Object.keys(configs).map(key => [key, '@fixture/adapter'])), ...configs });
class LocalEndpoint extends Endpoint {
  readonly client = {};
  start() {} open() {} close() {} stop() {}
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function runtime(configs: Record<string, unknown>) {
  const root = rootPluginId();
  const slots = Object.keys(configs).map(key => createCapabilitySlot({ owner: childPluginId(root, key),
    feature: adapterFeatureId, localName: 'shared-capability-name', source: '/fixture/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound'], create: () => new LocalEndpoint() }) }));
  const snapshot: RuntimeSnapshot = { generation: 7, root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@fixture/root', packageRoot: '/fixture', children: slots.map(slot => slot.owner) }],
      ...slots.map((slot, i) => [slot.owner, { id: slot.owner, instanceKey: Object.keys(configs)[i]!, packageName: '@fixture/same-adapter', packageRoot: '/fixture', children: [] }] as const)]),
    config: new Map(slots.map((slot, i) => [slot.owner, configs[Object.keys(configs)[i]!]])),
    resources: new Map(slots.map(slot => [slot.owner, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])])),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map() };
  const index = await AdapterIndex.create(slots, snapshot, new AbortController().signal);
  cleanups.push(() => index.stop());
  return { index, snapshot: { ...snapshot, projections: new Map([[adapterFeatureId, index]]) },
    conversation(pluginKey: string, endpointId: string) {
      const adapter = index.adapters().find(adapter => snapshot.tree.get(adapter.descriptor.owner)?.instanceKey === pluginKey)!;
      const child = adapter.runtimeEntries().find(child => child.desired.endpointId === endpointId)!;
      return { endpoint: { id: child.desired.canonicalId, adapter: 'same-platform' }, kind: 'group' as const, id: 'group' };
    } };
}

describe('trusted Endpoint role identity', () => {
  it('keeps same-named accounts isolated by the owning Plugin and supports canonical id', async () => {
    const resolver = await createEndpointRoleResolver(document({
      one: { endpoints: [{ id: 'same', name: 'same', master: 'owner-one', trusted: ['trusted-one'] }] },
      two: { endpoints: [{ id: 'same', name: 'same', master: 'owner-two', trusted: ['trusted-two'] }] },
    }));
    expect(resolver.resolveOwner('one', 'same')).toBe('owner-one');
    expect(resolver.resolveOwner('two', 'same')).toBe('owner-two');
    expect(resolver.resolveTrusted('one', 'same')).toEqual(['trusted-one']);
    expect(resolver.resolveTrusted('two', 'same')).toEqual(['trusted-two']);
    expect(resolver.resolveOwner('same', 'same')).toBeUndefined();
  });
  it('does not select another account from a nickname, capability local name or metadata', async () => {
    const configs = { one: { endpoints: [{ id: 'a', name: 'a', master: 'owner-a', trusted: ['trust-a'] },
      { id: 'b', name: 'b', master: 'attacker', trusted: ['trust-b'] }] },
      two: { endpoints: [{ id: 'a', name: 'a', master: 'owner-two', trusted: ['trust-two'] }] } };
    const state = await runtime(configs);
    const resolver = await createEndpointRoleResolver(document(configs));
    const enrich = (await createSenderEnricher(document(configs), resolver))!;
    const conversation = state.conversation('one', 'a');
    expect(enrich({ id: 'attacker', name: 'b', roles: ['member'] }, conversation, state.snapshot)?.roles).toEqual(['member']);
    expect(enrich({ id: 'owner-a', name: 'b' }, conversation, state.snapshot)?.roles).toEqual(['master']);
    expect(enrich({ id: 'trust-a', name: 'b' }, conversation, state.snapshot)?.roles).toEqual(['trusted']);
    expect(enrich({ id: 'owner-two', name: 'a' }, conversation, state.snapshot)?.roles).toBeUndefined();
  });
  it('resolves IM Agent owner and trusted from the same captured account, ignoring metadata', async () => {
    const configs = { one: { endpoints: [{ id: 'a', name: 'a', master: 'owner-a', trusted: ['trust-a'] },
      { id: 'b', name: 'b', master: 'attacker', trusted: ['trust-b'] }] },
      two: { endpoints: [{ id: 'a', name: 'a', master: 'owner-two', trusted: ['trust-two'] }] } };
    const state = await runtime(configs);
    const resolver = await createEndpointRoleResolver(document(configs));
    const conversation = state.conversation('one', 'a');
    const enrich = (await createSenderEnricher(document(configs), resolver))!;
    const message = new Message(conversation, 'hi', 7, async () => ({ status: 'sent' }), { id: 'attacker', name: 'b' },
      { endpoint: 'b', endpointKey: 'b' }, undefined, undefined, 'b');
    expect(resolveOwnerForRuntimeMessage(message, resolver.resolveOwner, state.snapshot)).toBe('owner-a');
    expect(resolveTrustedForRuntimeMessage(message, resolver.resolveTrusted, state.snapshot)).toEqual(['trust-a']);
    const unknown = { ...conversation, endpoint: { ...conversation.endpoint, id: 'not-a-real-endpoint' } };
    expect(enrich({ id: 'attacker', name: 'b' }, unknown, state.snapshot)?.roles).toBeUndefined();
    const staleMessage = new Message(unknown, 'hi', 7, async () => ({ status: 'sent' }), { id: 'attacker' }, {}, undefined, undefined, 'b');
    expect(resolveOwnerForRuntimeMessage(staleMessage, resolver.resolveOwner, state.snapshot)).toBeUndefined();
    expect(resolveTrustedForRuntimeMessage(staleMessage, resolver.resolveTrusted, state.snapshot)).toEqual([]);
  });
  it('retains explicit global roles, unique single-account aliases and exact Plugin keys', async () => {
    const config = { ...document({ one: { name: 'alias', master: 'base', trusted: 't1,t2', endpoints: [{ name: 'account', master: 'leaf', trusted: ['t3'] }] },
      account: { master: 'exact' } }), ai: { trigger: { masters: ['global'], trusted: ['global-trusted'] } } };
    const resolver = await createEndpointRoleResolver(config);
    expect(resolver.resolveOwner('alias', 'account')).toBe('leaf');
    expect(resolver.resolveOwner('account', 'account')).toBe('exact');
    expect(resolver.resolveTrusted('one', 'account')).toEqual(['t1', 't2', 't3']);
    const enrich = (await createSenderEnricher(config, resolver))!;
    const snapshot: RuntimeSnapshot = { generation: 1, root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
    const conversation = { endpoint: { id: 'opaque', adapter: 'unknown' }, kind: 'private' as const, id: 'u' };
    expect(enrich({ id: 'global' }, conversation, snapshot)?.roles).toEqual(['master']);
    expect(enrich({ id: 'global-trusted' }, conversation, snapshot)?.roles).toEqual(['trusted']);
    const resolve = vi.fn(() => 'owner');
    const message = new Message(conversation, 'hi', 1, async () => ({ status: 'sent' }), undefined, { endpoint: 'account' });
    expect(resolveOwnerForRuntimeMessage(message, resolve)).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
  it('uses canonical endpoint ids while retaining display-name lookup compatibility', async () => {
    const resolver = await createEndpointRoleResolver(document({ one: {
      endpoints: [{ id: 'canonical', name: 'display', master: 'owner', trusted: ['trusted'] }],
    } }));
    expect(resolver.resolveOwner('one', 'canonical')).toBe('owner');
    expect(resolver.resolveTrusted('one', 'canonical')).toEqual(['trusted']);
    expect(resolver.resolveOwner('one', 'display')).toBe('owner');
  });
  it('propagates config read failures rather than treating them as an empty roles document', async () => {
    const failure = new Error('read failed');
    const config = { read: async () => { throw failure; } };
    await expect(createEndpointRoleResolver(config as never)).rejects.toBe(failure);
  });
});
