// Sandbox accounts are managed from the Console like other adapters' (#1250).
import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterIndex, AdapterManagementError, adapterFeatureId, endpointEventGatewayToken,
  type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, rootPluginId, type PluginConsoleRpcCall, type SnapshotState } from 'zhin.js';
import { httpHostToken } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import sandboxDefinition from '../adapters/sandbox/index.js';
import { createSandboxConsoleRpc } from '../src/console.js';
import sandboxPlugin from '../plugin.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

async function fixture() {
  const root = rootPluginId(), source = { endpoints: [{ id: 'sandbox-bot', owner: 'sandbox-user' }] };
  let saved: EndpointDesiredSnapshot = { revision: 0, endpoints: [] };
  const repository = { load: vi.fn(async () => saved), compareAndSet: vi.fn(async (_id, revision, endpoints, commitId) => {
    if (saved.revision !== revision) throw new AdapterManagementError('conflict', 'synthetic revision conflict');
    return saved = structuredClone({ revision: revision + 1, endpoints, commitId });
  }) };
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => http.close());
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'sandbox', source: '/fixture/sandbox/adapters/sandbox/index.ts', definition: sandboxDefinition });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, source]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map<unknown, unknown>([[endpointEventGatewayToken.id, createTestEventGateway()], [httpHostToken.id, http]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(1, state), new AbortController().signal, { repository });
  await index.activate(new AbortController().signal); cleanup.push(() => index.stop());
  const adapter = index.adapter(slot.id)!;
  const rpc = createSandboxConsoleRpc(() => source);
  const call: PluginConsoleRpcCall = { signal: new AbortController().signal, runtime: { owner: root, generation: 1, operator: true, project: () => index.forOwner(root) } };
  const invoke = (name: string, input = {}) => rpc.methods.get(name)!.handler(input, call);
  return { adapter, invoke, saved: () => saved };
}

describe('Sandbox account management in the Console', () => {
  it('the plugin provides the shared adapter Console RPC (status and endpoint actions)', () => {
    const rpc = createSandboxConsoleRpc(() => ({}));
    expect([...rpc.methods.keys()]).toEqual(expect.arrayContaining(['status', 'endpoint-add', 'endpoint-start', 'endpoint-stop', 'endpoint-remove']));
    expect(typeof sandboxPlugin.setup).toBe('function');
  });

  it('adds, starts, stops and removes a Sandbox account through the owning adapter', async () => {
    const f = await fixture();
    const status = await f.invoke('status') as { canAdd: boolean; canRemove: boolean; fields: { key: string }[]; runtime?: { canStart?: boolean } };
    expect(status).toMatchObject({ adapterKey: 'sandbox', canAdd: true, canRemove: true });
    expect(status.fields.map(field => field.key)).toEqual(['owner', 'nickname', 'commandPrefix']);

    await expect(f.invoke('endpoint-add', { expectedGeneration: 1, expectedRevision: 0, id: 'tester', values: { owner: 'alice' } }))
      .resolves.toMatchObject({ saved: true });
    const added = f.adapter.list().find(entry => entry.endpointId === 'tester')!;
    expect(added.desiredEnabled).toBe(false);
    expect(f.saved().endpoints.find(entry => entry.config.id === 'tester')?.config).toMatchObject({ id: 'tester', owner: 'alice' });

    await expect(f.invoke('endpoint-start', { expectedGeneration: 1, expectedRevision: 1, instanceId: added.instanceId })).resolves.toMatchObject({ saved: true });
    expect(f.adapter.list().find(entry => entry.instanceId === added.instanceId)!.desiredEnabled).toBe(true);
    await expect(f.invoke('endpoint-stop', { expectedGeneration: 1, expectedRevision: 2, instanceId: added.instanceId })).resolves.toMatchObject({ saved: true });
    expect(f.adapter.list().find(entry => entry.instanceId === added.instanceId)!.desiredEnabled).toBe(false);
    await expect(f.invoke('endpoint-remove', { expectedGeneration: 1, expectedRevision: 3, instanceId: added.instanceId })).resolves.toMatchObject({ saved: true });
    expect(f.adapter.list().some(entry => entry.endpointId === 'tester')).toBe(false);
  });
});
