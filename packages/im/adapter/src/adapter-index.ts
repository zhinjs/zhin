import {
  assertDeclaredProfileActions,
  deriveLegacyProfile,
  operationsImpliedByProfile,
  resolveStaticCapabilities,
  resolveTurnCapabilities,
  selfStandingDeclared,
  type AdapterCapabilityProfile,
  type AdapterCapabilityResolver,
  type ResolveTurnCapabilitiesInput,
  type TurnCapabilities,
} from './capability-profile.js';
import { scopeEndpointControl, scopeEndpointManagement, type EndpointPortInvoker } from './scoped-endpoint-ports.js';
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
  parseAdapterDefinition,
  type AdapterCapability,
  type AdapterDefinition,
  type AdapterOperation,
  type AdapterSegmentPolicy,
  type EndpointIdentity,
  type EndpointSendRequest,
  type EndpointSendResult,
} from './definition.js';
import { type EndpointRuntime, type EndpointTransportState } from './endpoint.js';
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
  normalizePlatformStanding,
  type ConversationRef,
  type PlatformStanding,
  type ConversationReference,
  type ConversationResolution,
  type EndpointCapabilities,
  type EndpointKindCapabilities,
} from '@zhin.js/im-contract';

import type { AdapterInstance } from './adapter.js';
import { type EndpointDesiredRepository, type EndpointSecretResolver, type EndpointDesiredRecord, type EndpointChildLease, type EndpointChildView, type EndpointPortScope } from './adapter-types.js';
import { bindPlatformEndpoint, endpointRuntimeOf, type AnyEndpoint } from './endpoint-specification.js';
import { configuredSelfProfile, endpointCreationConfiguration, isEndpointProfileConfigurationChange, mergeEndpointProfileConfiguration,
  type SelfProfile, type SelfProfilePort, type SelfProfileSnapshot } from './endpoint-profile.js';

/** ADR 0056 §1: how long the Bot's own standing in one conversation is reused. */
export const SELF_STANDING_TTL_MS = 60_000;
/** A failed / unknown answer is retried sooner. */
export const SELF_STANDING_UNKNOWN_TTL_MS = 10_000;
const SELF_STANDING_MAX_ENTRIES = 1024;

interface SelfStandingEntry {
  readonly at: number;
  readonly ttl: number;
  readonly value: PlatformStanding | undefined;
}

export interface SelfStandingLookupOptions {
  readonly signal?: AbortSignal;
  /** Answer from the cache only; never start a platform lookup (middleware gates). */
  readonly cachedOnly?: boolean;
  readonly now?: number;
}

type SelfStandingConversation = Pick<ConversationRef, 'kind' | 'id' | 'parent' | 'threadId'>;

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
  readonly eventDiagnostics: EndpointRuntime['eventDiagnostics'];
  readonly connected: boolean;
  readonly status: 'online' | 'offline';
  readonly phase: AdapterEndpointPhase;
  readonly managementCapabilities: readonly EndpointManagementCapability[];
}

/** Immutable connection data. SDK and executable framework ports remain lease-scoped. */
export interface EndpointConnectionInfo {
  readonly identity: EndpointIdentity;
  readonly name?: string;
  readonly selfUserId?: string;
  readonly profile?: SelfProfileSnapshot;
  readonly transportState?: EndpointTransportState;
  readonly eventDiagnostics: AdapterEndpointSummary['eventDiagnostics'];
}

export type AdapterEndpointPhase =
  'pending' | 'starting' | 'online' | 'reconnecting' | 'offline';

interface AdapterRecord extends AdapterDescriptor {
  readonly adapterName: string;
  readonly endpoint?: AnyEndpoint;
  readonly segments?: AdapterSegmentPolicy;
  /** Declared profile, or the conservative one derived from legacy declarations. */
  readonly profile: AdapterCapabilityProfile;
  readonly capabilityResolver?: AdapterCapabilityResolver;
  readonly started: boolean;
  readonly open: boolean;
  readonly stopped: boolean;
  readonly startAttempted: boolean;
}

/** Concrete receiver and originating lifetime captured before creating port closures. */
interface EndpointPortBinding {
  readonly id: CapabilityId;
  readonly endpoint: AnyEndpoint;
  readonly scope?: EndpointPortScope;
}

/** Snapshot-owned directory metadata; account state remains exclusively in Adapter instances. */
interface AdapterIndexConstruction {
  readonly adapters: readonly AdapterInstance[];
  readonly admission: GenerationAdmissionGate;
  readonly ownerAliases: ReadonlyMap<PluginId, string>;
  readonly configurations: ReadonlyMap<PluginId, unknown>;
  readonly slots: readonly Readonly<CapabilitySlot>[];
}

/** An explicit selector is resolved only when exactly one account matches. */
interface AdapterEndpointSelector {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly packageAlias?: string;
}

export class AdapterIndex {
  readonly $projection = 'zhin.adapter-index/1' as const;
  readonly #adapters: readonly AdapterInstance[];
  readonly #ownerAliases: ReadonlyMap<PluginId, string>;
  readonly #configurations: ReadonlyMap<PluginId, unknown>;
  readonly #slots: readonly Readonly<CapabilitySlot>[];
  readonly #profileDefaults = new Map<PluginId, Readonly<SelfProfile>>();
  readonly #fileProfiles = new Map<CapabilityId, Readonly<SelfProfile>>();
  readonly #selfStanding = new Map<string, SelfStandingEntry>();
  readonly #selfStandingInflight = new Map<string, Promise<PlatformStanding | undefined>>();
  readonly [generationAdmissionSource]: readonly [GenerationAdmissionGate];

  private constructor({ adapters, admission, ownerAliases, configurations, slots }: AdapterIndexConstruction) {
    this.#adapters = Object.freeze([...adapters]);
    this.#ownerAliases = ownerAliases;
    this.#configurations = new Map(configurations);
    this.#slots = Object.freeze([...slots]);
    for (const slot of slots) {
      const configuration = configurationObject(configurations.get(slot.owner));
      this.#profileDefaults.set(slot.owner, configuredSelfProfile(configuration));
      for (const expansion of expandEndpointConfigs(slot, { config: configurations })) {
        this.#fileProfiles.set(expansion.id, configuredSelfProfile(expansion.config ?? {}));
      }
    }
    this[generationAdmissionSource] = Object.freeze([admission] as const);
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
  endpointEntry(id: CapabilityId): ReturnType<AdapterInstance['find']> {
    for (const adapter of this.#adapters) {
      const entry = adapter.find(id);
      if (entry !== undefined) return entry;
    }
    return undefined;
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

  static async create<TDefinition extends AdapterDefinition<never>>(
    slots: readonly Readonly<CapabilitySlot<TDefinition>>[],
    snapshot: RuntimeSnapshot,
    signal: AbortSignal,
    persistence: AdapterPersistencePorts = {},
  ): Promise<AdapterIndex> {
    const adapters: AdapterInstance[] = [];
    const admission = createGenerationAdmissionGate();
    try {
      for (const slot of [...slots].sort((left, right) => left.id.localeCompare(right.id))) {
        signal.throwIfAborted();
        const definition = parseAdapterDefinition(slot.definition);
        const construction = createConstructionContext(snapshot, slot.owner, admission, signal);
        const { endpoints: _endpoints, master: _master, trusted: _trusted, ...creationDefaults } =
          (construction.config ?? {}) as Readonly<Record<string, unknown>>;
        const initial: EndpointDesiredRecord[] = expandEndpointConfigs(slot, snapshot).map(expansion => ({
          instanceId: expansion.id, canonicalId: expansion.id, endpointId: expansion.endpointId,
          revision: 1, desiredEnabled: true,
          config: expansion.config ?? endpointCreationConfiguration((construction.config ?? {}) as Readonly<Record<string, unknown>>, {}),
        }));
        const makeContext = (record: EndpointDesiredRecord, childSignal: AbortSignal) => Object.freeze({
          ...createConstructionContext(snapshot, slot.owner, admission, childSignal),
          config: mergeEndpointProfileConfiguration(creationDefaults, record.config),
          id: record.canonicalId, endpointId: record.endpointId, name: slot.localName,
        });
        const baseContext = Object.freeze({ ...construction, id: slot.id, endpointId: slot.localName, name: slot.localName });
        const adapter = definition.createAdapter(baseContext);
        await adapter.initialize({
          descriptor: { id: slot.id, owner: slot.owner, name: slot.localName, source: slot.source,
            capabilities: definition.capabilities, segments: definition.segments,
            ...(definition.profile ? { profile: definition.profile } : {}),
            ...(definition.resolveCapabilities ? { resolveCapabilities: definition.resolveCapabilities } : {}) }, initial,
          ...persistence,
          creationDefaults,
          bind: (endpoint, record, childSignal) => {
            const context = makeContext(record, childSignal);
            // A declared profile implies its operations, so they are not declared a second time.
            const operations = Object.freeze([...new Set([
              ...resolveAdapterOperations(definition, context),
              ...(definition.profile ? operationsImpliedByProfile(definition.profile) : []),
            ])]);
            const runtime = endpointRuntimeOf(endpoint);
            if (definition.capabilities.includes('outbound') && typeof runtime.send !== 'function') {
              throw new TypeError(`Adapter Endpoint ${record.canonicalId} declares outbound but send() is missing`);
            }
            bindPlatformEndpoint(endpoint, context, admission);
            assertDeclaredEndpointOperations(runtime, operations, String(record.canonicalId));
            if (definition.profile) {
              assertDeclaredProfileActions(runtime, definition.profile, String(record.canonicalId),
                definition.capabilities.includes('outbound'));
            }
            return operations;
          },
        }, signal);
        adapters.push(adapter);
      }
      const ownerAliases = new Map<PluginId, string>();
      for (const adapter of adapters) {
        const packageName = snapshot.tree.get(adapter.descriptor.owner)?.packageName;
        if (packageName) ownerAliases.set(adapter.descriptor.owner, packageName.replace(/^@[^/]+\/adapter-/, ''));
      }
      return new AdapterIndex({ adapters, admission, ownerAliases,
        configurations: snapshot.config, slots });
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

  /**
   * Prepare a snapshot-owned profile view, sharing the existing projection lifetime.
   * No Client, account state, admission or persisted desired record is mutated here.
   */
  prepareConfigUpdate(snapshot: RuntimeSnapshot, changedOwners: readonly PluginId[]): AdapterIndex | undefined {
    const configurations = new Map(this.#configurations);
    for (const owner of changedOwners) {
      if (!this.#adapters.some(adapter => adapter.descriptor.owner === owner)) return undefined;
      const previous = configurationObject(configurations.get(owner));
      const next = configurationObject(snapshot.config.get(owner));
      if (!profileConfigurationOnly(previous, next)) return undefined;
      for (const slot of this.#slots.filter(value => value.owner === owner)) {
        const candidate = snapshot.capabilities.get(slot.id);
        if (!candidate || candidate.definition !== slot.definition || candidate.source !== slot.source) return undefined;
        configuredSelfProfile(next);
        for (const expansion of expandEndpointConfigs(slot, { ...snapshot, config: new Map([[owner, next]]) })) {
          configuredSelfProfile(expansion.config ?? next);
        }
      }
      configurations.set(owner, next);
    }
    return new AdapterIndex({ adapters: this.#adapters,
      admission: this[generationAdmissionSource][0], ownerAliases: this.#ownerAliases,
      configurations, slots: this.#slots });
  }

  #profile(id: CapabilityId): SelfProfilePort | undefined {
    const adapter = this.adapterForEndpoint(id);
    const child = adapter?.find(id);
    const state = child?.endpoint && endpointRuntimeOf(child.endpoint).selfProfile;
    if (!adapter || !child || !state) return undefined;
    const defaults = this.#profileDefaults.get(adapter.descriptor.owner);
    const explicit = adapter.revision === null && this.#fileProfiles.has(id)
      ? this.#fileProfiles.get(id) : adapter.configuredProfile(child.desired.instanceId);
    return state.withDefaults({ ...defaults, ...explicit });
  }

  list(): readonly AdapterDescriptor[] {
    return this.#order.map(({ endpoint: _endpoint,
      started: _started, open: _open, stopped: _stopped,
      startAttempted: _startAttempted, segments: _segments, adapterName: _adapterName,
      profile: _profile, capabilityResolver: _resolver,
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

  /** One snapshot-owned selector contract for Core, Console and plugin callers. */
  resolve(adapter: string, endpointKey: string): CapabilityId | undefined {
    const matches = (record: AdapterRecord) => matchesEndpoint(record, {
      adapter, endpointKey, packageAlias: this.#ownerAliases.get(record.owner),
    });
    const canonical = this.#record(endpointKey as CapabilityId);
    if (canonical && matches(canonical)) return canonical.id;
    const candidates = this.#order.filter(matches);
    return candidates.length === 1 ? candidates[0]?.id : undefined;
  }

  /** Read connection facts without exposing SDK objects or unscoped framework operations. */
  connection(adapter: string, endpointKey: string): EndpointConnectionInfo | undefined {
    const id = this.resolve(adapter, endpointKey);
    const endpoint = id ? this.#record(id)?.endpoint : undefined;
    if (!id || !endpoint) return undefined;
    const runtime = endpointRuntimeOf(endpoint);
    const profile = this.#profile(id);
    return Object.freeze({
      identity: runtime.identity,
      name: endpointLiveName(endpoint),
      selfUserId: runtime.selfUserId,
      ...(profile ? { profile: profile.peek() } : {}),
      transportState: runtime.transportState,
      eventDiagnostics: runtime.eventDiagnostics,
    });
  }

  /** Resolve the platform-native client owned by one active Endpoint. */
  client<TClient>(adapter: string, endpointKey: string): TClient {
    const id = this.resolve(adapter, endpointKey);
    const record = id ? this.#record(id) : undefined;
    if (!record) throw new Error(`Endpoint ${adapter}/${endpointKey} does not exist`);
    if (!record.started || record.stopped || !record.endpoint) {
      throw new Error(`Endpoint ${adapter}/${endpointKey} is not active`);
    }
    return record.endpoint as TClient;
  }

  /** Resolve the Client directly from a generation-stable CapabilityId. */
  clientById<TClient>(id: CapabilityId): TClient {
    const record = this.#record(id);
    if (!record) throw new EndpointDeliveryError('endpoint_not_found', `Unknown Adapter Endpoint: ${id}`, 'not_sent');
    if (!record.started || record.stopped || !record.endpoint) {
      throw new Error(`Adapter Endpoint ${id} is not active`);
    }
    return record.endpoint as TClient;
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
    return record.endpoint as TClient;
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
    return Object.freeze({ ...endpointCapabilitiesOf(record, record.operations),
      kinds: endpointKindCapabilities(record.profile, record.operations) });
  }

  /** Returns the control port only when the concrete Endpoint declared the operation and is active. */
  control(id: CapabilityId, operation: AdapterOperation, scope?: EndpointPortScope): EndpointControl | undefined {
    const record = this.#record(id);
    if (!record || !record.started || record.stopped || !record.endpoint) return undefined;
    if (!record.operations.includes(operation)) return undefined;
    const port = endpointControlOf(record.endpoint ? endpointRuntimeOf(record.endpoint) : undefined);
    return port && record.endpoint ? scopeEndpointControl({ port, invoke: this.#portInvoker({ id, endpoint: record.endpoint, scope }) }) : undefined;
  }

  management(id: CapabilityId, scope?: EndpointPortScope): EndpointManagement | undefined {
    const record = this.#record(id);
    const port = record?.endpoint ? endpointRuntimeOf(record.endpoint).management : undefined;
    return port && record?.endpoint ? scopeEndpointManagement({ port, invoke: this.#portInvoker({ id, endpoint: record.endpoint, scope }) }) : undefined;
  }
  /** Capture the original Client and originating lifetime, exactly like management/control ports. */
  profile(id: CapabilityId, scope?: EndpointPortScope): SelfProfilePort | undefined {
    const record = this.#record(id);
    const endpoint = record?.endpoint;
    const state = endpoint && this.#profile(id);
    if (!endpoint || !state) return undefined;
    const invoke = this.#portInvoker({ id, endpoint, scope });
    const write = state.write;
    return Object.freeze({
      peek: () => {
        scope?.assertActive?.();
        const lease = this.acquire(id, scope?.signal, endpoint);
        try { return state.peek(); } finally { lease.release(); }
      },
      read: request => invoke({ signal: request.signal,
        run: signal => state.read({ ...request, signal }) }),
      ...(write ? { write: request => invoke({ signal: request.signal,
        run: signal => write.call(state, { ...request, signal }) }) } : {}),
    } satisfies SelfProfilePort);
  }
  /** Each facade captures its original Client; calls cannot resolve a replacement incarnation. */
  #portInvoker({ id, endpoint, scope }: EndpointPortBinding): EndpointPortInvoker {
    return async ({ run, signal }) => {
      scope?.assertActive?.();
      const releaseScope = scope?.retain?.();
      try {
        const callerSignal = scope?.signal
          ? signal ? AbortSignal.any([scope.signal, signal]) : scope.signal : signal;
        const lease = this.acquire(id, callerSignal, endpoint);
        try { return await lease.run((_endpoint, activeSignal) => run(activeSignal)); }
        finally { lease.release(); }
      } finally { releaseScope?.(); }
    };
  }

  /**
   * Endpoint 的消息段能力声明（出站协商降级依据）；
   * 未声明或未知 id 返回 undefined（调用方按历史行为处理）。
   */
  segmentPolicy(id: CapabilityId): AdapterSegmentPolicy | undefined {
    return this.#record(id)?.segments;
  }

  /** Effective capability profile of an Endpoint: declared, or derived from its legacy declarations. */
  capabilityProfile(id: CapabilityId): AdapterCapabilityProfile | undefined {
    return this.#record(id)?.profile;
  }

  /**
   * ADR 0056 §1: the Bot account's own standing in one conversation, for `bot:*` permits. Only where
   * the profile declares `scene.selfStanding` and the Endpoint implements
   * `management.inspectSelfStanding`; private chats and failures are `undefined` (unknown). Answers
   * are cached per conversation for {@link SELF_STANDING_TTL_MS} (unknown ones shorter) within this
   * generation, concurrent lookups share one platform call, and {@link invalidateSelfStanding}
   * drops entries when the Bot's role changes. `cachedOnly` never waits for the platform: it
   * answers from a fresh cache entry and refreshes a missing / expired one in the background — an
   * expired entry answers *unknown* (a stale standing never satisfies a `bot:*` permit).
   */
  async selfStanding(id: CapabilityId, conversation: SelfStandingConversation, options: SelfStandingLookupOptions = {}): Promise<PlatformStanding | undefined> {
    if (conversation.kind === 'private') return undefined;
    const record = this.#record(id);
    if (!record || !selfStandingDeclared(record.profile, conversation)) return undefined;
    const key = selfStandingKey(id, conversation);
    const now = options.now ?? Date.now();
    const cached = this.#selfStanding.get(key);
    if (cached && now - cached.at < cached.ttl) return cached.value;
    const inflight = this.#selfStandingInflight.get(key);
    if (options.cachedOnly) {
      // Warm the cache in the background (one lookup per TTL, shared); answer with what is known now.
      if (!inflight) void this.selfStanding(id, conversation, { ...(options.now !== undefined ? { now: options.now } : {}) }).catch(() => undefined);
      return undefined;
    }
    if (inflight) return inflight;
    const management = this.management(id);
    const inspect = management?.inspectSelfStanding;
    if (!inspect) return undefined;
    const task = (async () => {
      let value: PlatformStanding | undefined;
      try {
        value = normalizePlatformStanding(await inspect({
          conversation: Object.freeze({ kind: conversation.kind, id: conversation.id,
            ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
            ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}) }),
          signal: options.signal ?? AbortSignal.timeout(10_000),
        }));
      } catch {
        value = undefined;
      }
      if (this.#selfStanding.size >= SELF_STANDING_MAX_ENTRIES) {
        const oldest = this.#selfStanding.keys().next();
        if (!oldest.done) this.#selfStanding.delete(oldest.value);
      }
      this.#selfStanding.delete(key);
      this.#selfStanding.set(key, Object.freeze({ at: Date.now(), ttl: value ? SELF_STANDING_TTL_MS : SELF_STANDING_UNKNOWN_TTL_MS, value }));
      return value;
    })();
    this.#selfStandingInflight.set(key, task);
    try { return await task; } finally { this.#selfStandingInflight.delete(key); }
  }

  /** Drops cached Bot standings of one conversation (or every conversation of the Endpoint). */
  invalidateSelfStanding(id: CapabilityId, conversation?: Pick<ConversationRef, 'kind' | 'id'>): void {
    const prefix = `${id}\u0000`;
    for (const key of [...this.#selfStanding.keys()]) {
      if (!key.startsWith(prefix)) continue;
      if (!conversation || key.startsWith(`${prefix}${conversation.kind}\u0000${conversation.id}\u0000`)) this.#selfStanding.delete(key);
    }
  }

  /**
   * Resolve the capabilities of one turn for an Endpoint (ADR 0044 §2): static profile + generic
   * narrowing + the Adapter's narrow-only `resolveCapabilities`. Unknown ids resolve to `undefined`.
   */
  turnCapabilities(
    id: CapabilityId,
    input: Omit<ResolveTurnCapabilitiesInput, 'profile' | 'narrow'>,
  ): TurnCapabilities | undefined {
    const record = this.#record(id);
    if (!record) return undefined;
    return resolveTurnCapabilities({
      ...input,
      profile: record.profile,
      ...(record.capabilityResolver ? { narrow: record.capabilityResolver } : {}),
    });
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
    for (const adapter of this.#adapters) adapter.assertExternalLifecycle('close');
    const stack = new DisposeStack();
    for (const adapter of this.#adapters) stack.add(() => adapter.close());
    await stack.dispose();
  }
  async stop(): Promise<void> {
    for (const adapter of this.#adapters) adapter.assertExternalLifecycle('stop');
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
    const lease = this.acquire(id, context.signal, record.endpoint);
    try { return await lease.run((_endpoint, signal) => content.resolve(reference, { ...context, signal })); }
    finally { lease.release(); }
  }
}

function configurationObject(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Adapter configuration must be an object');
  return value as Readonly<Record<string, unknown>>;
}

/** Endpoint order, identity and connection data remain unchanged, including per-account values. */
function profileConfigurationOnly(previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): boolean {
  const { endpoints: previousEndpoints, ...previousDefaults } = previous;
  const { endpoints: nextEndpoints, ...nextDefaults } = next;
  if (!isEndpointProfileConfigurationChange(previousDefaults, nextDefaults)) return false;
  if (previousEndpoints === undefined && nextEndpoints === undefined) return true;
  if (!Array.isArray(previousEndpoints) || !Array.isArray(nextEndpoints) || previousEndpoints.length !== nextEndpoints.length) return false;
  return previousEndpoints.every((value, index) => {
    const before = configurationObject(value), after = configurationObject(nextEndpoints[index]);
    return isEndpointProfileConfigurationChange(before, after);
  });
}

const KIND_VIEWS = ['private', 'group', 'channel'] as const;

/** The serializable per-kind consumer view of a capability profile (see `EndpointCapabilities.kinds`). */
export function endpointKindCapabilities(
  profile: AdapterCapabilityProfile,
  operations: readonly AdapterOperation[] = [],
): NonNullable<EndpointCapabilities['kinds']> {
  const kinds: Partial<Record<(typeof KIND_VIEWS)[number], EndpointKindCapabilities>> = {};
  for (const kind of KIND_VIEWS) {
    const section = resolveStaticCapabilities(profile, [kind]);
    const feedback = section.feedback;
    kinds[kind] = Object.freeze({
      ...(feedback?.mode ? {
        feedback: Object.freeze({
          mode: feedback.mode,
          ...(feedback.emoji ? { emoji: feedback.emoji } : {}),
          ...(feedback.text ? { text: feedback.text } : {}),
          ...(feedback.refreshSeconds ? { refreshSeconds: feedback.refreshSeconds } : {}),
        }),
      } : {}),
      // `operations` may add what a static profile cannot say (e.g. Discord reactions exist only on the
      // gateway transport, so they live in the Adapter's per-Endpoint `operations`).
      reaction: Boolean(section.actions?.reaction) || operations.includes('reaction'),
      edit: section.messaging?.edit === true || operations.includes('edit'),
      recall: Boolean(section.actions?.recall || section.messaging?.recall) || operations.includes('recall'),
      spool: section.delivery?.spool === true,
      needsReply: section.delivery?.proactive === false,
      groupInfo: section.scene?.groupInfo === true,
      memberProfile: section.scene?.memberProfile === true,
    });
  }
  return Object.freeze(kinds);
}

/**
 * Adapters without a declared profile get `scene.groupInfo` / `scene.memberProfile` from the lookup
 * ports their Endpoint actually implements (a port that exists is a capability that is usable).
 */
function withPortDerivedScene(profile: AdapterCapabilityProfile, endpoint: AnyEndpoint | undefined): AdapterCapabilityProfile {
  const management = endpoint ? endpointRuntimeOf(endpoint).management : undefined;
  const groupInfo = typeof management?.inspectGroupScene === 'function';
  const memberProfile = typeof management?.inspectGroupMemberProfile === 'function'
    || typeof management?.inspectGroupMember === 'function';
  if (!groupInfo && !memberProfile) return profile;
  return Object.freeze({
    ...profile,
    group: Object.freeze({
      ...profile.group,
      scene: Object.freeze({
        ...profile.group?.scene,
        ...(groupInfo ? { groupInfo: true } : {}),
        ...(memberProfile ? { memberProfile: true } : {}),
      }),
    }),
  });
}

function projectRecord(adapter: AdapterInstance, child: EndpointChildView): AdapterRecord {
  const declared = adapter.descriptor.profile;
  const profile = declared ?? withPortDerivedScene(deriveLegacyProfile({
    capabilities: adapter.descriptor.capabilities,
    operations: child.operations,
    ...(adapter.descriptor.segments ? { segments: adapter.descriptor.segments } : {}),
  }), child.endpoint);
  return {
    profile,
    ...(adapter.descriptor.resolveCapabilities ? { capabilityResolver: adapter.descriptor.resolveCapabilities } : {}),
    id: child.desired.canonicalId, owner: adapter.descriptor.owner, name: child.desired.endpointId,
    adapterName: adapter.descriptor.name, source: adapter.descriptor.source,
    capabilities: adapter.descriptor.capabilities, operations: child.operations,
    endpoint: child.endpoint, segments: adapter.descriptor.segments,
    started: child.started, open: child.open, stopped: child.stopped, startAttempted: child.startAttempted,
  };
}

function selfStandingKey(id: CapabilityId, conversation: SelfStandingConversation): string {
  return [id, conversation.kind, conversation.id, conversation.threadId ?? '', conversation.parent ? `${conversation.parent.kind}:${conversation.parent.id}` : ''].join('\u0000');
}

export function isAdapterIndex(value: unknown): value is AdapterIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.adapter-index/1';
}

function matchesEndpoint(record: AdapterRecord, { adapter, endpointKey, packageAlias }: AdapterEndpointSelector): boolean {
  const localName = record.id.split('\0').pop() ?? record.id;
  const adapterOk = record.adapterName === adapter
    || packageAlias === adapter
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
  slot: Readonly<Pick<CapabilitySlot, 'id' | 'owner' | 'localName'>>,
  snapshot: Pick<RuntimeSnapshot, 'config'>,
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
    config: Object.freeze({ ...endpointCreationConfiguration(base, entry), id: entry.id }),
  })));
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
