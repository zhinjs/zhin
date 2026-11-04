import { EventEmitter } from 'node:events';
import { afterEach, vi } from 'vitest';
import { SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type PluginId, type PluginNodeSnapshot, type PluginConsoleRpcCall, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, AdapterManagementError, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  endpointEventGatewayToken, type Endpoint, type EndpointDesiredRecord, type EndpointDesiredRepository, type EndpointDesiredSnapshot } from '../src/index.js';

class NativeClient extends EventEmitter {
  readonly connect = vi.fn(async (_signal: AbortSignal) => undefined);
  readonly disconnect = vi.fn(async () => undefined);
}
class AccountEndpoint extends NativeClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, { start: signal => this.connect(signal), open() {}, close() {}, stop: () => this.disconnect(), send: async () => 'native-message' });
}
class AccountAdapter extends Adapter<AccountEndpoint> {
  readonly created: AccountEndpoint[] = [];
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] { return ['token', 'baseUrl', 'label', 'smtp.port', 'smtp.secure']; }
  protected createEndpoint(): AccountEndpoint { const endpoint = new AccountEndpoint(); this.created.push(endpoint); return endpoint; }
}
export class AccountRepository implements EndpointDesiredRepository {
  readonly state = new Map<CapabilityId, EndpointDesiredSnapshot>();
  readonly load = vi.fn(async (id: CapabilityId): Promise<EndpointDesiredSnapshot | undefined> => structuredClone(this.state.get(id)));
  readonly compareAndSet = vi.fn(async (id: CapabilityId, expected: number | null, endpoints: readonly EndpointDesiredRecord[], commitId?: string): Promise<EndpointDesiredSnapshot> => {
    if ((this.state.get(id)?.revision ?? null) !== expected) throw new AdapterManagementError('conflict', 'synthetic revision conflict');
    const next = structuredClone({ revision: (expected ?? 0) + 1, endpoints, commitId }); this.state.set(id, next); return next;
  });
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/** Same owning Index and CAS port as production, without file writers, provider IO or another account registry. */
export async function accountRuntimeFixture(options: { config?: Record<string, unknown>; migration?: boolean; noDatabase?: boolean } = {}) {
  const root = rootPluginId(), owner = childPluginId(root, 'one'), otherOwner = childPluginId(root, 'two');
  const source = options.config ?? { endpoints: [] }, repository = new AccountRepository();
  const adapters = new Map([[owner, new AccountAdapter()], [otherOwner, new AccountAdapter()]]);
  const slots = [...adapters].map(([id, adapter]) => createCapabilitySlot({ owner: id, feature: adapterFeatureId, localName: 'demo', source: '/fixture/adapters/demo/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) }));
  if (!options.migration) for (const slot of slots) repository.state.set(slot.id, { revision: 1, endpoints: [] });
  const state: SnapshotState = { root, tree: new Map<PluginId, PluginNodeSnapshot>([
    [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [owner, otherOwner] }],
    ...[owner, otherOwner].map(id => [id, { id, parent: root, instanceKey: String(id), packageName: 'fixture-child', packageRoot: '/fixture/child', children: [] }] as const),
  ]), config: new Map([[owner, source], [otherOwner, { endpoints: [] }]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
    resources: new Map([owner, otherOwner].map(id => [id, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive: async () => undefined }]])])) };
  const index = await AdapterIndex.create(slots, createSnapshotView(0, state), new AbortController().signal, options.noDatabase ? {} : { repository });
  await index.activate(new AbortController().signal);
  const snapshot = { ...state, projections: new Map([[adapterFeatureId, index]]) }, store = new SnapshotStore(snapshot);
  cleanup.push(() => store.close(), () => index.stop());
  const adapter = adapters.get(owner)!, otherAdapter = adapters.get(otherOwner)!;
  const use = vi.fn(() => { throw new Error('Account management must not read a file/env writer'); });
  const commandContext = (overrides: Record<string, unknown> = {}) => ({ owner, generation: 0, project: () => index, use, params: {}, args: [], config: source,
    input: undefined, signal: new AbortController().signal, ...overrides }) as never;
  const call = (overrides: Partial<PluginConsoleRpcCall> = {}): PluginConsoleRpcCall => ({ signal: new AbortController().signal,
    runtime: { owner, generation: 0, operator: true, project: () => index.forOwner(owner) }, ...overrides });
  const request = (extra: Record<string, unknown> = {}) => ({ expectedGeneration: 0, expectedRevision: adapter.revision, ...extra });
  return { root, owner, otherOwner, index, adapter, otherAdapter, repository, source, state, snapshot, store, use, commandContext, call, request };
}
