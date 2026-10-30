import {
  DisposeStack,
  GenerationCompensationError,
  createGenerationAdmissionGate,
  generationAdmissionSource,
  type CapabilityId,
  type CapabilitySlot,
  type GenerationAdmissionGate,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { createConstructionContext } from '@zhin.js/feature-kit';
import {
  endpointCapabilitiesOf,
  resolveAdapterOperations,
  type AdapterCapability,
  type AdapterDefinition,
  type AdapterOperation,
  type AdapterSegmentPolicy,
  type EndpointSendRequest,
  type EndpointSendResult,
} from './definition.js';
import { type Endpoint, type EndpointTransportState } from './endpoint.js';
import { materializeEndpoint } from './managed-endpoint.js';
import {
  listEndpointManagementCapabilities,
  type EndpointManagementCapability,
  type EndpointManagement,
} from './endpoint-management.js';
import {
  assertDeclaredEndpointOperations,
  endpointControlOf,
  type EndpointControl,
} from './endpoint-control.js';
import { endpointContentOf, type EndpointContentResolveContext } from './endpoint-content.js';
import {
  EndpointDeliveryError,
  type ConversationReference,
  type ConversationResolution,
  type EndpointCapabilities,
} from '@zhin.js/im-contract';

import { Adapter, type AdapterInstance } from './adapter.js';
import { type EndpointDesiredRepository, type EndpointSecretResolver, type EndpointDesiredRecord, type EndpointCreationContext, type EndpointChildLease, type EndpointChildView } from './adapter-types.js';
import { bindPlatformEndpoint, endpointRuntimeOf, endpointClientOf, type AnyEndpoint } from './endpoint-specification.js';

/** Trusted composition input, excluded from public snapshot resources and authoring contexts. */
export interface AdapterPersistencePorts {
  readonly repository?: EndpointDesiredRepository;
  readonly secrets?: EndpointSecretResolver;
}

export interface AdapterDescriptor {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly capabilities: readonly AdapterCapability[];
  readonly operations: readonly AdapterOperation[];
}

/** Console / Host-facing endpoint row, with admission separate from transport. */
export interface AdapterEndpointSummary extends AdapterDescriptor {
  readonly admitted: boolean;
  readonly transportState: EndpointTransportState | 'unknown';
  readonly eventDiagnostics: Endpoint['eventDiagnostics'];
  readonly connected: boolean;
  readonly status: 'online' | 'offline';
  readonly phase: AdapterEndpointPhase;
  readonly managementCapabilities: readonly EndpointManagementCapability[];
}

export type AdapterEndpointPhase =
  'pending' | 'starting' | 'online' | 'reconnecting' | 'offline';

interface AdapterRecord extends AdapterDescriptor {
  readonly adapterName: string;
  readonly endpoint?: AnyEndpoint;
  readonly segments?: AdapterSegmentPolicy;
  readonly started: boolean;
  readonly open: boolean;
  readonly stopped: boolean;
  readonly startAttempted: boolean;
}

export class AdapterIndex {
  readonly $projection = 'zhin.adapter-index/1' as const;
  readonly #adapters: readonly AdapterInstance[];
  readonly [generationAdmissionSource]: readonly GenerationAdmissionGate[];

  private constructor(adapters: readonly AdapterInstance[], admission: GenerationAdmissionGate) {
    this.#adapters = Object.freeze([...adapters]);
    this[generationAdmissionSource] = Object.freeze([admission]);
  }

  /** Same authority, restricted to one authenticated Plugin owner. No configuration or resource access. */
  forOwner(owner: PluginId): OwnedAdapterDirectory { return new OwnedAdapterDirectory(this, owner); }

  /** Sole state owners. This Index only projects their current children. */
  adapters(): readonly AdapterInstance[] { return this.#adapters; }
  adapter(adapterId: CapabilityId): AdapterInstance | undefined {
    return this.#adapters.find(adapter => adapter.descriptor.id === adapterId);
  }
  adapterForEndpoint(id: CapabilityId): AdapterInstance | undefined {
    return this.#adapters.find(adapter => adapter.find(id) !== undefined);
  }
  acquire(id: CapabilityId, signal?: AbortSignal, expectedClient?: unknown): EndpointChildLease {
    const adapter = this.#adapters.find(value => value.find(id));
    if (!adapter) throw new EndpointDeliveryError('endpoint_not_found', 'Unknown Adapter Endpoint', 'not_sent');
    return adapter.acquire(id, signal, expectedClient);
  }
  acquireInbound(id: CapabilityId, expectedClient: unknown, signal?: AbortSignal): EndpointChildLease {
    const adapter = this.adapterForEndpoint(id);
    if (!adapter) throw new EndpointDeliveryError('endpoint_not_found', 'Unknown Adapter Endpoint', 'not_sent');
    return adapter.acquireInbound(id, expectedClient, signal);
  }
  get #order(): readonly AdapterRecord[] {
    return this.#adapters.flatMap(adapter => adapter.runtimeEntries().map(child => projectRecord(adapter, child)));
  }
  #record(id: CapabilityId): AdapterRecord | undefined {
    const adapter = this.adapterForEndpoint(id);
    const child = adapter?.find(id);
    return adapter && child ? projectRecord(adapter, child) : undefined;
  }

  static async create(
    slots: readonly Readonly<CapabilitySlot<AdapterDefinition>>[],
    snapshot: RuntimeSnapshot,
    signal: AbortSignal,
    persistence: AdapterPersistencePorts = {},
  ): Promise<AdapterIndex> {
    const adapters: AdapterInstance[] = [];
    const admission = createGenerationAdmissionGate();
    try {
      for (const slot of [...slots].sort((left, right) => left.id.localeCompare(right.id))) {
        signal.throwIfAborted();
        const construction = createConstructionContext(snapshot, slot.owner, admission, signal);
        const { endpoints: _endpoints, master: _master, trusted: _trusted, ...creationDefaults } =
          (construction.config ?? {}) as Readonly<Record<string, unknown>>;
        const initial: EndpointDesiredRecord[] = expandEndpointConfigs(slot, snapshot).map(expansion => ({
          instanceId: expansion.id, canonicalId: expansion.id, endpointId: expansion.endpointId,
          revision: 1, desiredEnabled: true,
          config: expansion.config ?? (construction.config ?? {}) as Readonly<Record<string, unknown>>,
        }));
        const makeContext = (record: EndpointDesiredRecord, childSignal: AbortSignal) => Object.freeze({
          ...createConstructionContext(snapshot, slot.owner, admission, childSignal), config: record.config,
          id: record.canonicalId, endpointId: record.endpointId, name: slot.localName,
        });
        const baseContext = Object.freeze({ ...construction, id: slot.id, endpointId: slot.localName, name: slot.localName });
        const legacyCreate = slot.definition.create;
        const adapter = slot.definition.createAdapter?.(baseContext) ?? new LegacyAdapter(async (config, execution) => {
          if (!legacyCreate) throw new TypeError('Adapter requires create or createAdapter');
          const context = makeContext({ instanceId: execution.instanceId, canonicalId: execution.canonicalId,
            endpointId: execution.endpointId, revision: 1, desiredEnabled: true, config }, execution.signal);
          const implementation = await legacyCreate(context);
          return materializeEndpoint(implementation, context);
        });
        await adapter.initialize({
          descriptor: { id: slot.id, owner: slot.owner, name: slot.localName, source: slot.source,
            capabilities: slot.definition.capabilities, segments: slot.definition.segments }, initial,
          ...persistence,
          creationDefaults,
          bind: (endpoint, record, childSignal) => {
            const context = makeContext(record, childSignal);
            const operations = resolveAdapterOperations(slot.definition, context);
            const runtime = endpointRuntimeOf(endpoint);
            if (slot.definition.capabilities.includes('outbound') && typeof runtime.send !== 'function') {
              throw new TypeError(`Adapter Endpoint ${record.canonicalId} declares outbound but send() is missing`);
            }
            bindPlatformEndpoint(endpoint, context, admission);
            assertDeclaredEndpointOperations(runtime, operations, String(record.canonicalId));
            return operations;
          },
        }, signal);
        adapters.push(adapter);
      }
      return new AdapterIndex(adapters, admission);
    } catch (error) {
      const stack = new DisposeStack();
      for (const adapter of adapters) stack.add(() => adapter.dispose());
      try { await stack.dispose(); } catch (cleanupError) {
        throw new GenerationCompensationError([error, cleanupError],
          'Adapter prepare and Endpoint cleanup both failed', { cause: cleanupError });
      }
      throw error;
    }
  }

  list(): readonly AdapterDescriptor[] {
    return this.#order.map(({ endpoint: _endpoint,
      started: _started, open: _open, stopped: _stopped,
      startAttempted: _startAttempted, segments: _segments, adapterName: _adapterName,
      ...descriptor }) => Object.freeze(descriptor));
  }

  /** Endpoint rows for Console `endpoint.list` / `endpoint.info`. */
  describe(): readonly AdapterEndpointSummary[] {
    return Object.freeze(this.#order.map((record) => Object.freeze({
      id: record.id,
      owner: record.owner,
      // Console 展示用 live name（如 ICQQ uin、sandbox bot 名），缺省回退 slot localName
      name: endpointLiveName(record.endpoint) ?? record.name,
      source: record.source,
      capabilities: record.capabilities,
      operations: record.operations,
      admitted: record.open && !record.stopped,
      transportState: record.stopped ? 'stopped' : (record.endpoint ? endpointRuntimeOf(record.endpoint).transportState : undefined) ?? 'unknown',
      eventDiagnostics: (record.endpoint ? endpointRuntimeOf(record.endpoint).eventDiagnostics : undefined) ?? Object.freeze({ buffered: 0, dropped: 0, dispatchFailures: 0 }),
      connected: endpointConnected(record),
      status: endpointConnected(record) ? 'online' as const : 'offline' as const,
      phase: endpointPhase(record),
      managementCapabilities: listEndpointManagementCapabilities(record.endpoint ? endpointRuntimeOf(record.endpoint) : undefined),
    })));
  }

  /**
   * Resolve a Console `$adapter` + `$endpoint` pair to a capability id.
   * Matches local name, capability id, or owner path segments.
   */
  resolve(adapter: string, endpointKey: string): CapabilityId | undefined {
    const canonical = this.#record(endpointKey as CapabilityId);
    if (canonical && matchesEndpoint(canonical, adapter, endpointKey)) return canonical.id;
    const matches = this.#order.filter((record) =>
      matchesEndpoint(record, adapter, endpointKey));
    if (matches.length === 1) return matches[0]?.id;
    if (matches.length === 0) return undefined;
    // Prefer exact localName === endpointKey when ambiguous.
    const exact = matches.find((record) => record.name === endpointKey);
    return exact?.id ?? matches[0]?.id;
  }

  /** Resolve the framework-owned Endpoint for internal Host control ports. */
  connection(adapter: string, endpointKey: string): Endpoint | undefined {
    const id = this.resolve(adapter, endpointKey);
    if (!id) return undefined;
    const endpoint = this.#record(id)?.endpoint;
    return endpoint ? endpointRuntimeOf(endpoint) : undefined;
  }

  /** Resolve the platform-native client owned by one active Endpoint. */
  client<TClient>(adapter: string, endpointKey: string): TClient {
    const id = this.resolve(adapter, endpointKey);
    const record = id ? this.#record(id) : undefined;
    if (!record) throw new Error(`Endpoint ${adapter}/${endpointKey} does not exist`);
    if (!record.started || record.stopped || !record.endpoint) {
      throw new Error(`Endpoint ${adapter}/${endpointKey} is not active`);
    }
    return endpointClientOf(record.endpoint) as TClient;
  }

  /** Resolve the Client directly from a generation-stable CapabilityId. */
  clientById<TClient>(id: CapabilityId): TClient {
    const record = this.#record(id);
    if (!record) throw new EndpointDeliveryError('endpoint_not_found', `Unknown Adapter Endpoint: ${id}`, 'not_sent');
    if (!record.started || record.stopped || !record.endpoint) {
      throw new Error(`Adapter Endpoint ${id} is not active`);
    }
    return endpointClientOf(record.endpoint) as TClient;
  }

  /** Literal adapter name used by authoring-context type discrimination. */
  clientAdapter(id: CapabilityId): string {
    const record = this.#record(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    if (!record.endpoint) {
      const adapter = this.adapterForEndpoint(id);
      if (!adapter) throw new Error('Endpoint Adapter is unavailable');
      return adapter.descriptor.name;
    }
    return endpointRuntimeOf(record.endpoint).identity.adapter;
  }

  /** Optional Client lookup for cross-platform middleware and routing. */
  findClient<TClient>(adapter: string, endpointKey: string): TClient | undefined {
    const id = this.resolve(adapter, endpointKey);
    const record = id ? this.#record(id) : undefined;
    if (!record || !record.started || record.stopped || !record.endpoint) return undefined;
    return endpointClientOf(record.endpoint) as TClient;
  }

  owner(id: CapabilityId): PluginId {
    const record = this.#record(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return record.owner;
  }

  /** Exact, serializable capabilities for one concrete Endpoint. */
  capabilities(id: CapabilityId): EndpointCapabilities {
    const record = this.#record(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return endpointCapabilitiesOf(record, record.operations);
  }

  /** Returns the control port only when the concrete Endpoint declared the operation and is active. */
  control(id: CapabilityId, operation: AdapterOperation): EndpointControl | undefined {
    const record = this.#record(id);
    if (!record || !record.started || record.stopped || !record.endpoint) return undefined;
    if (!record.operations.includes(operation)) return undefined;
    const port = endpointControlOf(record.endpoint ? endpointRuntimeOf(record.endpoint) : undefined);
    return port && record.endpoint ? this.#scopedPort(id, record.endpoint, port) : undefined;
  }

  management(id: CapabilityId, assertScope?: () => void): EndpointManagement | undefined {
    const record = this.#record(id);
    const port = record?.endpoint ? endpointRuntimeOf(record.endpoint).management : undefined;
    return port && record?.endpoint ? this.#scopedPort(id, record.endpoint, port, assertScope) : undefined;
  }
  #scopedPort<T extends object>(id: CapabilityId, endpoint: AnyEndpoint, port: T, assertScope?: () => void): T {
    const expectedClient = endpointClientOf(endpoint);
    return new Proxy({ ...port }, { get: (target, key) => {
      const value = Reflect.get(port, key);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        assertScope?.();
        const callerSignal = args.find((argument): argument is AbortSignal => argument instanceof AbortSignal);
        const lease = this.acquire(id, callerSignal, expectedClient);
        const scopedArgs = args.map(argument => argument === callerSignal ? lease.signal : argument);
        try { return await lease.run(() => Reflect.apply(value, port, scopedArgs)); }
        finally { lease.release(); }
      };
    } });
  }

  /**
   * Endpoint 的消息段能力声明（出站协商降级依据）；
   * 未声明或未知 id 返回 undefined（调用方按历史行为处理）。
   */
  segmentPolicy(id: CapabilityId): AdapterSegmentPolicy | undefined {
    return this.#record(id)?.segments;
  }

  async start(signal: AbortSignal = new AbortController().signal): Promise<void> {
    try {
      for (const adapter of this.#adapters) await adapter.activate(signal);
    } catch (error) {
      try { await this.stop(); } catch (cleanupError) {
        throw new GenerationCompensationError([error, cleanupError],
          'Adapter prepare and Endpoint cleanup both failed', { cause: cleanupError });
      }
      throw error;
    }
  }

  async activate(signal: AbortSignal): Promise<void> {
    try { await this.start(signal); this.open(); }
    catch (error) { await this.stop(); throw error; }
  }
  open(): void {
    const errors: unknown[] = [];
    for (const adapter of this.#adapters) {
      try { adapter.open(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Adapter Endpoint open failed');
  }
  async close(): Promise<void> {
    const stack = new DisposeStack();
    for (const adapter of this.#adapters) stack.add(() => adapter.close());
    await stack.dispose();
  }
  async stop(): Promise<void> {
    const stack = new DisposeStack();
    for (const adapter of this.#adapters) stack.add(() => adapter.dispose());
    await stack.dispose();
  }

  async send(id: CapabilityId, request: EndpointSendRequest): Promise<EndpointSendResult> {
    const lease = this.acquire(id, request.signal);
    try { return await lease.send(request); }
    finally { lease.release(); }
  }

  async resolveContent(
    id: CapabilityId,
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ): Promise<ConversationResolution> {
    const record = this.#record(id);
    if (!record) return Object.freeze({ status: 'not_found', code: 'endpoint_not_found' });
    if (!record.started || record.stopped || !record.endpoint) {
      return Object.freeze({ status: 'failed', code: 'endpoint_not_active' });
    }
    const content = endpointContentOf(record.endpoint ? endpointRuntimeOf(record.endpoint) : undefined);
    if (!content) return Object.freeze({ status: 'unsupported', code: 'content_resolution_unsupported' });
    context.signal.throwIfAborted();
    const lease = this.acquire(id, context.signal, endpointClientOf(record.endpoint));
    try { return await lease.run((_endpoint, signal) => content.resolve(reference, { ...context, signal })); }
    finally { lease.release(); }
  }
}

function projectRecord(adapter: AdapterInstance, child: EndpointChildView): AdapterRecord {
  return {
    id: child.desired.canonicalId, owner: adapter.descriptor.owner, name: child.desired.endpointId,
    adapterName: adapter.descriptor.name, source: adapter.descriptor.source,
    capabilities: adapter.descriptor.capabilities, operations: child.operations,
    endpoint: child.endpoint, segments: adapter.descriptor.segments,
    started: child.started, open: child.open, stopped: child.stopped, startAttempted: child.startAttempted,
  };
}

export function isAdapterIndex(value: unknown): value is AdapterIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.adapter-index/1';
}

function matchesEndpoint(
  record: AdapterRecord,
  adapter: string,
  endpointKey: string,
): boolean {
  // 消息上的 $adapter 是 CapabilityId 的 localName 段（多 endpoint 展开后形如
  // `icqq~8596238`）。CapabilityId 段分隔符是 \0（owner\0feature\0localName），
  // 不能用 `/` 去 endsWith，否则永远匹配不上（endpoint not found）。
  const localName = record.id.split('\0').pop() ?? record.id;
  const adapterOk = record.adapterName === adapter
    || record.name === adapter
    || record.id === adapter
    || localName === adapter
    || record.id.endsWith(`/${adapter}`)
    || record.owner === adapter
    || record.owner.endsWith(`/${adapter}`);
  // The live Endpoint identity is the bot runtime id (e.g. ICQQ uin). Host /
  // activity-feedback resolve with that id; slot.localName alone is not enough
  // when multiple plugin instances share localName "icqq".
  const liveName = endpointLiveName(record.endpoint);
  const endpointOk = record.name === endpointKey
    || localName === endpointKey
    || record.id === endpointKey
    || record.id.endsWith(`/${endpointKey}`)
    || (liveName !== undefined && liveName === endpointKey);
  return adapterOk && endpointOk;
}

function endpointLiveName(endpoint: AnyEndpoint | undefined): string | undefined {
  const name = endpoint ? (endpointRuntimeOf(endpoint) as { readonly name?: unknown }).name : undefined;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function endpointPhase(record: AdapterRecord): AdapterEndpointPhase {
  if (record.stopped) return 'offline';
  if (record.open) {
    if ((record.endpoint ? endpointRuntimeOf(record.endpoint).transportState : undefined) === 'reconnecting') return 'reconnecting';
    return endpointConnected(record) ? 'online' : 'offline';
  }
  if (record.startAttempted && !record.started) return 'starting';
  return 'pending';
}

function endpointConnected(record: AdapterRecord): boolean {
  return record.open && !record.stopped && (record.endpoint ? endpointRuntimeOf(record.endpoint).transportState : undefined) === 'open';
}

/** 单个实例配置展开的 endpoint 描述（多账号适配器经 `endpoints` 数组声明）。 */
interface EndpointExpansion {
  readonly id: CapabilityId;
  readonly endpointId: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * 实例配置的 endpoint 展开：插件实例 config 含非空 `endpoints: [{id, ...覆盖}]` 时
 * 按数组一一创建 endpoint（基础配置为实例 config 去掉 `endpoints` 键，逐项合并），
 * 否则按实例 config 创建单个 endpoint（历史行为）。
 */
function expandEndpointConfigs(
  slot: Readonly<CapabilitySlot<AdapterDefinition>>,
  snapshot: RuntimeSnapshot,
): readonly EndpointExpansion[] {
  const config = snapshot.config.get(slot.owner) as
    | { id?: unknown; endpoints?: unknown }
    | undefined;
  const raw = config?.endpoints;
  if (raw !== undefined && !Array.isArray(raw)) {
    throw new TypeError(`Adapter ${slot.id} endpoints must be an array`);
  }
  const entries = (raw ?? []) as readonly unknown[];
  if (entries.length === 0) {
    const endpointId = typeof config?.id === 'string' && config.id.trim() ? config.id.trim() : slot.localName;
    return Object.freeze([{ id: slot.id, endpointId }]);
  }
  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object'
      || typeof (entry as { id?: unknown }).id !== 'string'
      || (entry as { id: string }).id.length === 0) {
      throw new TypeError(`Adapter ${slot.id} endpoints[${index}].id must be a non-empty string`);
    }
    return entry as Record<string, unknown> & { id: string };
  });
  // `~` 是 record id 的分隔符、\0 是 CapabilityId 的分隔符，混入会破坏解析。
  for (const entry of normalized) {
    if (/[~\0]/u.test(entry.id)) {
      throw new TypeError(`Adapter ${slot.id} endpoint id contains a reserved delimiter: ${entry.id}`);
    }
  }
  const seen = new Set<string>();
  for (const entry of normalized) {
    if (seen.has(entry.id)) {
      throw new TypeError(`Adapter ${slot.id} endpoint id is duplicated: ${entry.id}`);
    }
    seen.add(entry.id);
  }
  const { endpoints: _drop, ...base } = (config ?? {}) as Record<string, unknown>;
  return Object.freeze(normalized.map((entry) => Object.freeze({
    id: `${slot.id}~${entry.id}` as CapabilityId,
    endpointId: entry.id,
    config: Object.freeze({ ...base, ...entry, id: entry.id }),
  })));
}

class LegacyAdapter extends Adapter<AnyEndpoint> {
  readonly #create: (config: Readonly<Record<string, unknown>>, context: EndpointCreationContext) => Promise<AnyEndpoint>;
  constructor(create: (config: Readonly<Record<string, unknown>>, context: EndpointCreationContext) => Promise<AnyEndpoint>) { super(); this.#create = create; }
  protected createEndpoint(config: Readonly<Record<string, unknown>>, context: EndpointCreationContext): Promise<AnyEndpoint> {
    return this.#create(config, context);
  }
}

/** Narrow Console projection, never a second account manager or lifecycle owner. */
export class OwnedAdapterDirectory {
  readonly $ownedAdapterDirectory = 'zhin.owned-adapter-directory/1' as const;
  readonly #source: AdapterIndex;
  readonly owner: PluginId;
  constructor(source: AdapterIndex, owner: PluginId) { this.#source = source; this.owner = owner; }
  adapters(): readonly AdapterInstance[] {
    return Object.freeze(this.#source.adapters().filter(adapter => adapter.descriptor.owner === this.owner));
  }
  adapter(id: CapabilityId): AdapterInstance | undefined {
    const adapter = this.#source.adapter(id);
    return adapter?.descriptor.owner === this.owner ? adapter : undefined;
  }
}
export function isOwnedAdapterDirectory(value: unknown): value is OwnedAdapterDirectory {
  return !!value && typeof value === 'object'
    && (value as Partial<OwnedAdapterDirectory>).$ownedAdapterDirectory === 'zhin.owned-adapter-directory/1'
    && typeof (value as Partial<OwnedAdapterDirectory>).adapters === 'function'
    && typeof (value as Partial<OwnedAdapterDirectory>).adapter === 'function';
}
