import { afterEach, describe, expect, it } from 'vitest';
import { AdapterIndex, Adapter, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { childPluginId, createCapabilitySlot, rootPluginId, type PluginId, type PluginNodeSnapshot, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { Message, createSenderEnricher } from '@zhin.js/core/runtime';
import { ChatRoleService } from '@zhin.js/core';
import { resolveOwnerForRuntimeMessage } from '@zhin.js/agent/runtime';
import { ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';

const document = (configs: Record<string, unknown>) => ({ configVersion: 2 as const,
  plugins: Object.fromEntries(Object.keys(configs).map(key => [key, '@fixture/adapter'])), ...configs });
class LocalClient {}
class LocalEndpoint extends LocalClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} });
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function runtime(configs: Record<string, unknown>) {
  const root = rootPluginId();
  const slots = Object.keys(configs).map(key => createCapabilitySlot({ owner: childPluginId(root, key),
    feature: adapterFeatureId, localName: 'shared-capability-name', source: '/fixture/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound'], createAdapter: () => new class extends Adapter<LocalEndpoint> { protected createEndpoint() { return new LocalEndpoint(); } }() }) }));
  const snapshot: RuntimeSnapshot = { generation: 7, root,
    tree: new Map<PluginId, PluginNodeSnapshot>([[root, { id: root, instanceKey: 'root', packageName: '@fixture/root', packageRoot: '/fixture', children: slots.map(slot => slot.owner) }],
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

async function grants(entries: readonly (readonly [level: 'global' | 'adapter' | 'endpoint', key: string, adapter: string, userId: string, role: 'owner' | 'admin' | 'trusted'])[]) {
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore() });
  for (const [level, key, adapter, userId, role] of entries) await roles.store.grant({ level, key, adapter, userId, role });
  return roles;
}

describe('chat role sender identity (ADR 0056)', () => {
  it('keeps same-named accounts isolated by the owning Plugin instance alias', async () => {
    const configs = { one: { endpoints: [{ id: 'same' }] }, two: { endpoints: [{ id: 'same' }] } };
    const state = await runtime(configs);
    const roles = await grants([['endpoint', 'one/same', 'one', 'owner-one', 'owner'], ['endpoint', 'two/same', 'two', 'owner-two', 'owner'],
      ['endpoint', 'one/same', 'one', 'trusted-one', 'trusted']]);
    const enrich = createSenderEnricher({ roles: () => roles })!;
    expect(enrich({ id: 'owner-one' }, state.conversation('one', 'same'), state.snapshot)?.chatRole).toBe('owner');
    expect(enrich({ id: 'owner-two' }, state.conversation('one', 'same'), state.snapshot)?.chatRole).toBeUndefined();
    expect(enrich({ id: 'owner-two' }, state.conversation('two', 'same'), state.snapshot)?.chatRole).toBe('owner');
    expect(enrich({ id: 'trusted-one' }, state.conversation('one', 'same'), state.snapshot)?.chatRole).toBe('trusted');
  });

  it('does not select another account from a nickname, metadata or a spoofed chat role', async () => {
    const configs = { one: { endpoints: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] }, two: { endpoints: [{ id: 'a', name: 'a' }] } };
    const state = await runtime(configs);
    const roles = await grants([['endpoint', 'one/a', 'one', 'owner-a', 'owner'], ['endpoint', 'one/b', 'one', 'attacker', 'owner']]);
    const enrich = createSenderEnricher({ roles: () => roles })!;
    const conversation = state.conversation('one', 'a');
    expect(enrich({ id: 'attacker', name: 'b', platform: { standing: 'member' } }, conversation, state.snapshot))
      .toEqual({ id: 'attacker', name: 'b', platform: { standing: 'member' }, chatPrincipal: roles.principalOf({ adapter: 'one', userId: 'attacker' }).id });
    // ADR 0060 §2.3: an adapter cannot claim to be the owner's person.
    const ownerPerson = roles.principalOf({ adapter: 'one', userId: 'owner-a' }).id;
    const spoofed = enrich({ id: 'attacker', chatPrincipal: ownerPerson } as never, conversation, state.snapshot);
    expect(spoofed?.chatPrincipal).not.toBe(ownerPerson);
    expect(spoofed?.chatRole).toBeUndefined();
    expect(enrich({ id: 'attacker', chatRole: 'owner' }, conversation, state.snapshot)?.chatRole).toBeUndefined();
    expect(enrich({ id: 'owner-a', name: 'b' }, conversation, state.snapshot)?.chatRole).toBe('owner');
    const unknown = { ...conversation, endpoint: { ...conversation.endpoint, id: 'not-a-real-endpoint' } };
    expect(enrich({ id: 'owner-a' }, unknown, state.snapshot)?.chatRole).toBeUndefined();
  });

  it('resolves the owner approval address from stored owners of the captured account, ignoring metadata', async () => {
    const configs = { one: { endpoints: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] } };
    const state = await runtime(configs);
    const roles = await grants([['endpoint', 'one/a', 'one', 'owner-a', 'owner'], ['endpoint', 'one/b', 'one', 'attacker', 'owner'],
      ['global', '', 'one', 'global-owner', 'owner']]);
    const resolve = (alias: string, endpointId: string) => roles.ownersOf(`${alias}/${endpointId}`, alias)[0];
    const conversation = state.conversation('one', 'a');
    const message = new Message({ conversation, content: 'hi', sender: { id: 'attacker', name: 'b' }, metadata: { endpoint: 'b', endpointKey: 'b' }, endpointId: 'b' },
      { generation: 7, reply: async () => ({ status: 'sent' }) });
    expect(resolveOwnerForRuntimeMessage(message, resolve, state.snapshot)).toBe('owner-a');
    expect(roles.ownersOf('one/b', 'one')).toEqual(['attacker', 'global-owner']);
    const stale = new Message({ conversation: { ...conversation, endpoint: { ...conversation.endpoint, id: 'not-a-real-endpoint' } },
      content: 'hi', sender: { id: 'attacker' }, metadata: {}, endpointId: 'b' }, { generation: 7, reply: async () => ({ status: 'sent' }) });
    expect(resolveOwnerForRuntimeMessage(stale, resolve, state.snapshot)).toBeUndefined();
  });

  it('applies global and adapter grants on their own adapter only', async () => {
    const configs = { one: { endpoints: [{ id: 'a' }] }, two: { endpoints: [{ id: 'a' }] } };
    const state = await runtime(configs);
    const roles = await grants([['global', '', 'one', 'g', 'owner'], ['adapter', 'two', 'two', 'm', 'admin']]);
    const enrich = createSenderEnricher({ roles: () => roles })!;
    expect(enrich({ id: 'g' }, state.conversation('one', 'a'), state.snapshot)?.chatRole).toBe('owner');
    expect(enrich({ id: 'g' }, state.conversation('two', 'a'), state.snapshot)?.chatRole).toBeUndefined();
    expect(enrich({ id: 'm' }, state.conversation('two', 'a'), state.snapshot)?.chatRole).toBe('admin');
    // Private chats carry no platform standing and so no mapped role.
    const privateChat = { ...state.conversation('one', 'a'), kind: 'private' as const, id: 'p' };
    expect(enrich({ id: 'p', platform: { standing: 'owner' } }, privateChat, state.snapshot)).toEqual({ id: 'p', chatPrincipal: 'implicit:one:p' });
  });
});
