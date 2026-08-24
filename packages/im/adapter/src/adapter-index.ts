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
import { createCapabilityContext } from '@zhin.js/feature-kit';
import {
  endpointCapabilitiesOf,
  resolveAdapterOperations,
  type AdapterCapability,
  type AdapterDefinition,
  type AdapterOperation,
  type AdapterSegmentPolicy,
  type EndpointSendRequest,
} from './definition.js';
import { bindEndpoint, isEndpoint, type Endpoint } from './endpoint.js';
import {
  listEndpointManagementCapabilities,
  type EndpointManagementCapability,
} from './endpoint-management.js';
import {
  assertDeclaredEndpointOperations,
  endpointControlOf,
  type EndpointControl,
} from './endpoint-control.js';
import { endpointContentOf, type EndpointContentResolveContext } from './endpoint-content.js';
import type {
  ConversationReference,
  ConversationResolution,
  EndpointCapabilities,
} from '@zhin.js/im-contract';

export interface AdapterDescriptor {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly capabilities: readonly AdapterCapability[];
  readonly operations: readonly AdapterOperation[];
}

/** Console / Host-facing endpoint row (connected = admission open). */
export interface AdapterEndpointSummary extends AdapterDescriptor {
  readonly connected: boolean;
  readonly status: 'online' | 'offline';
  readonly phase: AdapterEndpointPhase;
  readonly managementCapabilities: readonly EndpointManagementCapability[];
}

export type AdapterEndpointPhase =
  'pending' | 'starting' | 'online';

interface AdapterRecord extends AdapterDescriptor {
  readonly endpoint: Endpoint;
  readonly segments?: AdapterSegmentPolicy;
  started: boolean;
  open: boolean;
  stopped: boolean;
  stopping?: Promise<void>;
  startAttempted: boolean;
}

export class AdapterIndex {
  readonly $projection = 'zhin.adapter-index/1' as const;
  readonly #records = new Map<CapabilityId, AdapterRecord>();
  readonly [generationAdmissionSource]: readonly GenerationAdmissionGate[];
  readonly #order: readonly AdapterRecord[];

  private constructor(
    records: readonly AdapterRecord[],
    admission: GenerationAdmissionGate,
  ) {
    this.#order = Object.freeze([...records]);
    this[generationAdmissionSource] = Object.freeze([admission]);
    for (const record of records) this.#records.set(record.id, record);
  }

  static async create(
    slots: readonly Readonly<CapabilitySlot<AdapterDefinition>>[],
    snapshot: RuntimeSnapshot,
    signal: AbortSignal,
  ): Promise<AdapterIndex> {
    const records: AdapterRecord[] = [];
    const admission = createGenerationAdmissionGate();
    try {
      for (const slot of [...slots].sort((left, right) => left.id.localeCompare(right.id))) {
        signal.throwIfAborted();
        for (const expansion of expandEndpointConfigs(slot, snapshot)) {
          const created = await createEndpoint(slot, snapshot, admission, signal, expansion);
          signal.throwIfAborted();
          records.push({
            id: expansion.id,
            owner: slot.owner,
            // 展开模式下 record name 即 endpoint id（entry.id），
            // 保证 Console 展示与 resolve/instance 按 entry id 命中唯一 record
            name: expansion.endpointId,
            source: slot.source,
            capabilities: slot.definition.capabilities,
            operations: created.operations,
            endpoint: created.endpoint,
            ...(slot.definition.segments ? { segments: slot.definition.segments } : {}),
            started: false,
            open: false,
            startAttempted: false,
            stopped: false,
          });
        }
      }
      return new AdapterIndex(records, admission);
    } catch (error) {
      await stopRecords(records, error);
      throw error;
    }
  }

  list(): readonly AdapterDescriptor[] {
    return this.#order.map(({ endpoint: _endpoint,
      started: _started, open: _open, stopped: _stopped, stopping: _stopping,
      startAttempted: _startAttempted, segments: _segments,
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
      connected: record.open && !record.stopped,
      status: record.open && !record.stopped ? 'online' as const : 'offline' as const,
      phase: endpointPhase(record),
      managementCapabilities: listEndpointManagementCapabilities(record.endpoint),
    })));
  }

  /**
   * Resolve a Console `$adapter` + `$endpoint` pair to a capability id.
   * Matches local name, capability id, or owner path segments.
   */
  resolve(adapter: string, endpointKey: string): CapabilityId | undefined {
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
    return this.#records.get(id)?.endpoint;
  }

  /** Resolve the platform-native client owned by one active Endpoint. */
  client<TClient>(adapter: string, endpointKey: string): TClient {
    const id = this.resolve(adapter, endpointKey);
    const record = id ? this.#records.get(id) : undefined;
    if (!record) throw new Error(`Endpoint ${adapter}/${endpointKey} does not exist`);
    if (!record.started || record.stopped) {
      throw new Error(`Endpoint ${adapter}/${endpointKey} is not active`);
    }
    return record.endpoint.client as TClient;
  }

  /** Resolve the Client directly from a generation-stable CapabilityId. */
  clientById<TClient>(id: CapabilityId): TClient {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    if (!record.started || record.stopped) {
      throw new Error(`Adapter Endpoint ${id} is not active`);
    }
    return record.endpoint.client as TClient;
  }

  /** Literal adapter name used by authoring-context type discrimination. */
  clientAdapter(id: CapabilityId): string {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return record.endpoint.identity.adapter;
  }

  /** Optional Client lookup for cross-platform middleware and routing. */
  findClient<TClient>(adapter: string, endpointKey: string): TClient | undefined {
    const id = this.resolve(adapter, endpointKey);
    const record = id ? this.#records.get(id) : undefined;
    if (!record || !record.started || record.stopped) return undefined;
    return record.endpoint.client as TClient;
  }

  owner(id: CapabilityId): PluginId {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return record.owner;
  }

  /** Exact, serializable capabilities for one concrete Endpoint. */
  capabilities(id: CapabilityId): EndpointCapabilities {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return endpointCapabilitiesOf(record, record.operations);
  }

  /** Returns the control port only when the concrete Endpoint declared the operation and is active. */
  control(id: CapabilityId, operation: AdapterOperation): EndpointControl | undefined {
    const record = this.#records.get(id);
    if (!record || !record.started || record.stopped) return undefined;
    if (!record.operations.includes(operation)) return undefined;
    return endpointControlOf(record.endpoint);
  }

  /**
   * Endpoint 的消息段能力声明（出站协商降级依据）；
   * 未声明或未知 id 返回 undefined（调用方按历史行为处理）。
   */
  segmentPolicy(id: CapabilityId): AdapterSegmentPolicy | undefined {
    return this.#records.get(id)?.segments;
  }

  async start(signal: AbortSignal = new AbortController().signal): Promise<void> {
    try {
      // Sequential readiness gives the candidate one owned in-flight start at a
      // time. A sibling failure can therefore never leave an un-awaited start
      // promise mutating resources after rollback has returned.
      for (const record of this.#order) {
        if (record.started || record.stopped) continue;
        record.startAttempted = true;
        signal.throwIfAborted();
        let stopOnAbort!: () => void;
        const aborted = new Promise<never>((_resolve, reject) => {
          stopOnAbort = () => {
            void stopRecord(record).then(
              () => reject(signal.reason ?? new Error('Adapter Endpoint start aborted')),
              (cleanupError) => reject(new GenerationCompensationError(
                [signal.reason, cleanupError],
                'Adapter Endpoint cancellation cleanup failed',
                { cause: cleanupError },
              )),
            );
          };
        });
        signal.addEventListener('abort', stopOnAbort, { once: true });
        try {
          await Promise.race([
            Promise.resolve(record.endpoint.start?.(signal)),
            aborted,
          ]);
        } finally {
          signal.removeEventListener('abort', stopOnAbort);
        }
        signal.throwIfAborted();
        if (record.stopped) throw new Error(`Adapter Endpoint stopped during start: ${record.id}`);
        if (record.endpoint.client === record.endpoint) {
          throw new TypeError(
            `Adapter Endpoint ${record.id} must expose a distinct platform client`,
          );
        }
        record.started = true;
      }
    } catch (error) {
      await stopRecords(this.#order, error);
      throw error;
    }
  }

  /** Required readiness boundary: no generation can publish a partial Endpoint set. */
  async activate(signal: AbortSignal): Promise<void> {
    try {
      await this.start(signal);
      this.open();
    } catch (error) {
      await stopRecords(this.#order, error);
      throw error;
    }
  }

  open(): void {
    const errors: unknown[] = [];
    for (const record of this.#order) {
      if (!record.started || record.open || record.stopped) continue;
      try {
        record.endpoint.open?.();
        record.open = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Adapter Endpoint open failed');
  }

  async close(): Promise<void> {
    const stack = new DisposeStack();
    for (const record of this.#order) {
      if (!record.open || record.stopped) continue;
      stack.add(async () => {
        await record.endpoint.close?.();
        record.open = false;
      });
    }
    await stack.dispose();
  }

  async stop(): Promise<void> {
    const stack = new DisposeStack();
    // DisposeStack unwinds in reverse: admission closes before transports stop,
    // and a close failure cannot skip transport cleanup.
    stack.add(() => stopRecords(this.#order));
    stack.add(() => this.close());
    await stack.dispose();
  }

  async send(id: CapabilityId, request: EndpointSendRequest): Promise<string> {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    if (!record.capabilities.includes('outbound') || !record.endpoint.send) {
      throw new Error(`Adapter Endpoint does not support outbound: ${id}`);
    }
    if (!record.started || record.stopped) {
      throw new Error(`Adapter Endpoint is not active: ${id}`);
    }
    const messageId = await record.endpoint.send(request);
    if (typeof messageId !== 'string' || !messageId.trim()) {
      throw new TypeError(`Adapter Endpoint send() must return a non-empty platform message id: ${id}`);
    }
    return messageId;
  }

  async resolveContent(
    id: CapabilityId,
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ): Promise<ConversationResolution> {
    const record = this.#records.get(id);
    if (!record) return Object.freeze({ status: 'not_found', code: 'endpoint_not_found' });
    if (!record.started || record.stopped) {
      return Object.freeze({ status: 'failed', code: 'endpoint_not_active' });
    }
    const content = endpointContentOf(record.endpoint);
    if (!content) return Object.freeze({ status: 'unsupported', code: 'content_resolution_unsupported' });
    context.signal.throwIfAborted();
    return content.resolve(reference, context);
  }
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
  const adapterOk = record.name === adapter
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
    || record.id === endpointKey
    || record.id.endsWith(`/${endpointKey}`)
    || (liveName !== undefined && liveName === endpointKey);
  return adapterOk && endpointOk;
}

function endpointLiveName(endpoint: Endpoint): string | undefined {
  const name = (endpoint as { readonly name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function endpointPhase(record: AdapterRecord): AdapterEndpointPhase {
  if (record.open && !record.stopped) return 'online';
  if (record.startAttempted && !record.started) return 'starting';
  return 'pending';
}

function assertEndpoint(value: unknown, id: CapabilityId): asserts value is Endpoint {
  if (!isEndpoint(value)) {
    throw new TypeError(`Adapter ${id} create() must return an Endpoint subclass`);
  }
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
    | { endpoints?: unknown }
    | undefined;
  const raw = config?.endpoints;
  if (raw !== undefined && !Array.isArray(raw)) {
    throw new TypeError(`Adapter ${slot.id} endpoints must be an array`);
  }
  const entries = (raw ?? []) as readonly unknown[];
  if (entries.length === 0) {
    return Object.freeze([{ id: slot.id, endpointId: slot.localName }]);
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

async function createEndpoint(
  slot: Readonly<CapabilitySlot<AdapterDefinition>>,
  snapshot: RuntimeSnapshot,
  admission: GenerationAdmissionGate,
  signal: AbortSignal,
  expansion?: EndpointExpansion,
): Promise<Readonly<{ endpoint: Endpoint; operations: readonly AdapterOperation[] }>> {
  const context = Object.freeze({
    ...createCapabilityContext(snapshot, slot.owner, admission, signal),
    ...(expansion?.config ? { config: expansion.config } : {}),
    id: expansion?.id ?? slot.id,
    name: slot.localName,
  });
  const operations = resolveAdapterOperations(slot.definition, context);
  const endpoint = await slot.definition.create(context);
  assertEndpoint(endpoint, expansion?.id ?? slot.id);
  bindEndpoint(endpoint, context, admission);
  if (slot.definition.capabilities.includes('outbound') && typeof endpoint.send !== 'function') {
    throw new TypeError(
      `Adapter Endpoint ${String(expansion?.id ?? slot.id)} declares outbound but send() is missing`,
    );
  }
  assertDeclaredEndpointOperations(
    endpoint,
    operations,
    String(expansion?.id ?? slot.id),
  );
  return Object.freeze({ endpoint, operations });
}

async function stopRecords(
  records: readonly AdapterRecord[],
  primaryError?: unknown,
): Promise<void> {
  const stack = new DisposeStack();
  for (const record of records) {
    if (record.stopped) continue;
    stack.add(() => stopRecord(record));
  }
  try {
    await stack.dispose();
  } catch (stopError) {
    if (primaryError !== undefined) {
      throw new GenerationCompensationError(
        [primaryError, stopError],
        'Adapter prepare and Endpoint cleanup both failed',
        { cause: stopError },
      );
    }
    throw stopError;
  }
}

function stopRecord(record: AdapterRecord): Promise<void> {
  if (record.stopped) return Promise.resolve();
  if (record.stopping) return record.stopping;
  const stopping = Promise.resolve(record.endpoint.stop?.()).then(() => {
    record.stopped = true;
    record.open = false;
  });
  record.stopping = stopping;
  void stopping.catch(() => undefined).finally(() => {
    if (!record.stopped && record.stopping === stopping) record.stopping = undefined;
  });
  return stopping;
}
