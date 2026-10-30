import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { DisposeStack, GenerationCompensationError, type CapabilityId } from '@zhin.js/plugin-runtime';
import { retireEndpoint } from './endpoint.js';
import { endpointClientOf, endpointRuntimeOf, type AnyEndpoint } from './endpoint-specification.js';
import type { EndpointSendRequest, EndpointSendResult } from './endpoint-contract.js';
import {
  AdapterManagementError,
  type AdapterDescriptorInfo, type EndpointChildLease, type EndpointChildView,
  type EndpointDesiredRecord, type EndpointDesiredRepository, type EndpointDesiredSnapshot,
  type EndpointCreationContext, type EndpointMetadata, type AdapterMutationResult, type EndpointSecretResolver,
  type EndpointExecution, type EndpointAction, type AdapterMutationOptions, type EndpointConfigurationView,
} from './adapter-types.js';

type ExecutionState = { -readonly [K in keyof EndpointExecution]: EndpointExecution[K] };
interface ChildEpoch<E extends AnyEndpoint> {
  readonly incarnationId: string;
  readonly identity: import('./adapter-types.js').EndpointDesiredMetadata;
  execution?: ExecutionState;
  cleanupFailed?: boolean;
  readonly epoch: number;
  readonly cancellation: AbortController;
  endpoint?: E;
  operations: EndpointChildView['operations'];
  preparation?: Promise<void>;
  starting?: Promise<void>;
  closing?: Promise<void>;
  started: boolean;
  open: boolean;
  retired: boolean;
  startAttempted: boolean;
  leases: number;
  drain?: () => void;
}
interface Child<E extends AnyEndpoint> {
  desired: EndpointDesiredRecord;
  epoch: number;
  current?: ChildEpoch<E>;
  execution?: ExecutionState;
}
interface MutationRequest<E extends AnyEndpoint> {
  readonly instanceId: string;
  readonly action: EndpointAction;
  readonly child?: Child<E>;
}
interface UncertainMutation<E extends AnyEndpoint> {
  readonly commitId: string;
  readonly revision: number;
  readonly endpoints: readonly EndpointDesiredRecord[];
  readonly request: MutationRequest<E>;
  readonly apply: (() => Promise<void>) | undefined;
}

export interface AdapterInitialization<E extends AnyEndpoint> {
  readonly descriptor: AdapterDescriptorInfo;
  readonly initial: readonly EndpointDesiredRecord[];
  readonly bind: (endpoint: E, record: EndpointDesiredRecord, signal: AbortSignal) => readonly import('./definition.js').AdapterOperation[];
  readonly repository?: EndpointDesiredRepository;
  readonly secrets?: EndpointSecretResolver;
  /** Captured startup connection defaults, used only once for newly added/replaced accounts. */
  readonly creationDefaults?: Readonly<Record<string, unknown>>;
}

/** Owns desired state and each child execution epoch. AdapterIndex is a read/routing projection. */
export abstract class Adapter<E extends AnyEndpoint = AnyEndpoint, Config = Readonly<Record<string, unknown>>, Events extends object = Record<string, unknown>> {
  declare readonly adapterEvents: Events;
  protected validateConfiguration(_config: Config): void {}
  /** Platforms must explicitly declare fields safe to update and fields defining identity. */
  get configurationUpdateFields(): readonly string[] | undefined { return undefined; }
  get configurationIdentityFields(): readonly string[] | undefined { return undefined; }
  protected endpointDisposed(_endpoint: E): void {}
  protected abstract createEndpoint(config: Config, context: EndpointCreationContext): E | Promise<E>;
  #descriptor?: AdapterDescriptorInfo;
  get descriptor(): AdapterDescriptorInfo {
    if (!this.#descriptor) throw new AdapterManagementError('unavailable', 'Adapter is not initialized');
    return this.#descriptor;
  }
  readonly #children = new Map<string, Child<E>>();
  readonly #canonical = new Map<CapabilityId, Child<E>>();
  #options!: AdapterInitialization<E>;
  #revision: number | null = null;
  #closed = false;
  #admission = false;
  #repositoryReady = false;
  #restoration?: Promise<void>;
  #mutation?: Promise<unknown>;
  #uncertain?: UncertainMutation<E>;
  #verification?: Promise<void>;
  readonly #operations = new Set<Promise<unknown>>();
  /** Retains actual resources after directory removal or replacement of current. */
  readonly #retiredEpochs = new Set<ChildEpoch<E>>();
  #lastMutation?: ExecutionState;

  async initialize(options: AdapterInitialization<E>, signal: AbortSignal): Promise<void> {
    if (this.#options) throw new AdapterManagementError('conflict', 'Adapter is already initialized');
    signal.throwIfAborted();
    this.#descriptor = Object.freeze({ ...options.descriptor });
    this.#options = options;
    this.#install({ revision: 0, endpoints: options.initial });
    this.#revision = null;
    this.#repositoryReady = options.repository === undefined;
    // Persistence needs the Host database's activation boundary. Do not construct a
    // legacy account which a persisted snapshot may have disabled or removed.
    if (options.repository) return;
    try {
      for (const child of this.#children.values()) {
        if (child.desired.desiredEnabled) await this.#prepare(child, signal);
      }
      signal.throwIfAborted();
    } catch (error) { await this.dispose(error); throw error; }
  }

  async #restore(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.#repositoryReady) return;
    const repository = this.#options.repository;
    if (!repository) throw new AdapterManagementError('integrity', 'Adapter persistence was not configured');
    this.#restoration ??= Promise.resolve().then(async () => {
      const loaded = await repository.load(this.descriptor.id);
      signal.throwIfAborted();
      this.#assertOpen();
      this.#install(loaded ?? { revision: 0, endpoints: this.#options.initial });
      if (loaded === undefined) this.#revision = null;
      this.#repositoryReady = true;
    });
    await this.#restoration;
  }

  getEndpoint(instanceId: string): E | undefined {
    const child = this.#children.get(instanceId);
    return child?.current?.retired ? undefined : child?.current?.endpoint;
  }
  list(): readonly EndpointMetadata[] {
    return Object.freeze([...this.#children.values()].map(child => Object.freeze({
      ...metadata(child.desired), epoch: child.epoch,
      ...(child.current ? { incarnationId: child.current.incarnationId } : {}),
      started: child.current?.started === true && !child.current.retired,
      admitted: child.current?.open === true && !child.current.retired,
      ...(child.execution ? { execution: Object.freeze({ ...child.execution }) } : {}),
    })));
  }
  get needsMigration(): boolean { return this.#revision === null && this.#children.size > 0; }
  get canManage(): boolean { return !!this.#options.repository && this.#repositoryReady && !this.#closed; }
  get lastMutation(): EndpointExecution | undefined {
    return this.#lastMutation ? Object.freeze({ ...this.#lastMutation }) : undefined;
  }
  runtimeStatus(): readonly EndpointMetadata[] {
    const retired = [...this.#retiredEpochs].map(epoch => Object.freeze({
      ...epoch.identity, desiredEnabled: false, epoch: epoch.epoch, incarnationId: epoch.incarnationId, started: false, admitted: false,
      retiring: true, removed: !this.#children.has(epoch.identity.instanceId),
      execution: Object.freeze({
        instanceId: epoch.identity.instanceId, revision: epoch.execution?.revision ?? this.#revision,
        action: epoch.execution?.action ?? 'stop',
        status: epoch.cleanupFailed ? 'failed' as const : 'pending' as const,
        ...(epoch.cleanupFailed ? { code: 'endpoint_cleanup_failed' } : {}),
      }),
    }));
    return Object.freeze([...this.list(), ...retired]);
  }
  /** Whitelist projection; no private snapshot or secret reference is returned. */
  configurationView(fields: readonly Readonly<{ key: string; secret?: boolean; env?: boolean }>[]): readonly EndpointConfigurationView[] {
    return Object.freeze([...this.#children.values()].map(child => {
      const values: Record<string, string> = {};
      for (const field of fields) {
        const value = child.desired.config[field.key];
        if (value === undefined && !child.desired.secretRefs?.[field.key]) continue;
        if (field.secret || field.env || child.desired.secretRefs?.[field.key]) values[field.key] = '••••••';
        else if (value !== undefined && value !== null) values[field.key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
      return Object.freeze({ id: child.desired.endpointId, instanceId: child.desired.instanceId, values: Object.freeze(values) });
    }));
  }
  /** @internal Directory projection, never a public management response. */
  runtimeEntries(): readonly EndpointChildView<E>[] {
    return Object.freeze([...this.#children.values()].map(child => this.#view(child)));
  }

  get revision(): number | null { return this.#revision; }
  /** Explicit status read: no write retry and no replay of an already admitted execution. */
  async verifyPendingCommit(): Promise<void> {
    if (this.#mutation) throw unknownCommit();
    const uncertain = this.#uncertain;
    if (!uncertain) return;
    this.#verification ??= Promise.resolve().then(async () => {
      let snapshot: EndpointDesiredSnapshot | undefined;
      const repository = this.#options.repository;
      if (!repository) throw unknownCommit();
      try { snapshot = await repository.load(this.descriptor.id); }
      catch { throw unknownCommit(); }
      this.#assertOpen();
      if (!snapshot || snapshot.commitId !== uncertain.commitId || snapshot.revision !== uncertain.revision
        || !samePersistedRecords(snapshot.endpoints, uncertain.endpoints)) throw unknownCommit();
      this.#install(snapshot);
      this.#uncertain = undefined;
      this.#admit(snapshot, uncertain.apply, uncertain.request);
    });
    const verification = this.#verification;
    try { await verification; }
    finally { if (this.#verification === verification) this.#verification = undefined; }
  }
  find(canonicalId: CapabilityId): EndpointChildView<E> | undefined {
    const child = this.#canonical.get(canonicalId);
    return child ? this.#view(child) : undefined;
  }

  add(expectedRevision: number | null, input: Readonly<{ endpointId: string; config: Readonly<Record<string, unknown>>;
    secretRefs?: Readonly<Record<string, string>> }>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const config = this.#creationConfiguration(input.endpointId, input.config);
    this.validateConfiguration(config as Config);
    const instanceId = randomUUID();
    return this.#mutate(expectedRevision, () => {
      const record: EndpointDesiredRecord = Object.freeze({ ...input, config, instanceId,
        canonicalId: `${this.descriptor.id}~${instanceId}` as CapabilityId,
        revision: 1, desiredEnabled: false });
      return [...this.#desired(), record];
    }, undefined, { instanceId, action: 'add' }, options);
  }

  update(instanceId: string, expectedRevision: number | null, input: Readonly<{
    config: Readonly<Record<string, unknown>>; secretRefs?: Readonly<Record<string, string>>;
  }>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const target = this.#require(instanceId);
    for (const field of this.configurationIdentityFields ?? []) {
      if (JSON.stringify(target.desired.config[field]) !== JSON.stringify(input.config[field])) {
        throw new AdapterManagementError('invalid_configuration', 'Account identity changes require explicit replacement');
      }
    }
    this.validateConfiguration(input.config as Config);
    return this.#mutate(expectedRevision, () => this.#replace(instanceId, record => ({
      ...record, config: input.config, secretRefs: input.secretRefs, revision: record.revision + 1,
    })), async () => {
      const child = this.#require(instanceId);
      await this.#stop(child);
      if (child.desired.desiredEnabled) await this.#start(child);
    }, { instanceId, action: 'update', child: target }, options);
  }

  start(instanceId: string, expectedRevision: number | null, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const target = this.#require(instanceId);
    return this.#mutate(expectedRevision, () => this.#replace(instanceId, record => ({
      ...record, desiredEnabled: true, revision: record.revision + 1,
    })), () => this.#start(target), { instanceId, action: 'start', child: target }, options);
  }
  stop(instanceId: string, expectedRevision: number | null, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const target = this.#require(instanceId);
    return this.#mutate(expectedRevision, () => this.#replace(instanceId, record => ({
      ...record, desiredEnabled: false, revision: record.revision + 1,
    })), () => this.#stop(target), { instanceId, action: 'stop', child: target }, options);
  }
  remove(instanceId: string, expectedRevision: number | null, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const child = this.#require(instanceId);
    return this.#mutate(expectedRevision, () => this.#desired().filter(record => record.instanceId !== instanceId),
      () => this.#stop(child), { instanceId, action: 'remove', child }, options);
  }

  /** One desired-state CAS replaces identity; it never inherits the old enabled intent. */
  replace(instanceId: string, expectedRevision: number | null, input: Readonly<{
    endpointId: string; config: Readonly<Record<string, unknown>>; secretRefs?: Readonly<Record<string, string>>;
  }>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const child = this.#require(instanceId);
    const config = this.#creationConfiguration(input.endpointId, input.config);
    this.validateConfiguration(config as Config);
    const replacementId = randomUUID();
    const record: EndpointDesiredRecord = Object.freeze({ ...input, config, instanceId: replacementId,
      canonicalId: `${this.descriptor.id}~${replacementId}` as CapabilityId, revision: 1, desiredEnabled: false });
    return this.#mutate(expectedRevision, () => this.#desired().map(value => value.instanceId === instanceId ? record : value),
      () => this.#stop(child), { instanceId, action: 'replace', child }, options);
  }

  patchConfiguration(instanceId: string, expectedRevision: number | null, patch: Readonly<Record<string, unknown>>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const allowed = this.configurationUpdateFields;
    if (!allowed) throw new AdapterManagementError('unsupported', 'This Adapter does not declare safe configuration updates');
    for (const key of Object.keys(patch)) if (!allowed.includes(key)) {
      throw new AdapterManagementError('invalid_configuration', 'The field is not updateable; identity changes require explicit replacement');
    }
    const previous = this.#require(instanceId).desired;
    const secretRefs = { ...previous.secretRefs };
    for (const key of Object.keys(patch)) delete secretRefs[key];
    return this.update(instanceId, expectedRevision, { config: { ...previous.config, ...patch }, secretRefs }, options);
  }

  async activate(signal: AbortSignal): Promise<void> {
    this.#assertOpen();
    await this.#restore(signal);
    for (const child of this.#children.values()) {
      if (child.desired.desiredEnabled) await this.#start(child, signal);
    }
  }
  open(): void {
    this.#assertOpen();
    this.#admission = true;
    const errors: unknown[] = [];
    for (const child of this.#children.values()) {
      try { this.#open(child); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Adapter Endpoint open failed');
  }
  async close(): Promise<void> {
    this.#admission = false;
    const stack = new DisposeStack();
    for (const child of this.#children.values()) {
      const epoch = child.current;
      if (!epoch?.endpoint || !epoch.open || epoch.retired) continue;
      epoch.open = false;
      const endpoint = epoch.endpoint;
      stack.add(() => endpointRuntimeOf(endpoint).close());
    }
    await stack.dispose();
  }
  async dispose(primaryError?: unknown): Promise<void> {
    this.#closed = true;
    this.#admission = false;
    const stack = new DisposeStack();
    const epochs = new Set(this.#retiredEpochs);
    for (const child of this.#children.values()) if (child.current) epochs.add(child.current);
    for (const epoch of epochs) stack.add(() => this.#stopEpoch(epoch));
    if (this.#restoration) await this.#restoration.catch(() => undefined);
    if (this.#mutation) {
      try { await this.#mutation; } catch { /* initiating caller observes persistence/execution failure */ }
    }
    try { await stack.dispose(); await Promise.allSettled([...this.#operations]); } catch (error) {
      if (primaryError !== undefined) throw new GenerationCompensationError([primaryError, error],
        'Adapter prepare and Endpoint cleanup both failed', { cause: error });
      throw error;
    }
  }

  acquire(canonicalId: CapabilityId, signal?: AbortSignal, expectedClient?: unknown): EndpointChildLease<E> {
    const captured = this.#capture(canonicalId);
    if (!captured.epoch.started) throw new EndpointDeliveryError('endpoint_inactive', 'Adapter Endpoint is not active', 'not_sent');
    if (expectedClient !== undefined) assertEndpointSource(captured.endpoint, expectedClient);
    return this.#lease(canonicalId, captured, signal);
  }

  /** A native callback may precede start readiness; source identity and lifetime still apply. */
  acquireInbound(canonicalId: CapabilityId, expectedClient: unknown, signal?: AbortSignal): EndpointChildLease<E> {
    const captured = this.#capture(canonicalId);
    assertEndpointSource(captured.endpoint, expectedClient);
    return this.#lease(canonicalId, captured, signal);
  }

  #capture(canonicalId: CapabilityId): Readonly<{ child: Child<E>; epoch: ChildEpoch<E>; endpoint: E }> {
    this.#assertOpen();
    const child = this.#canonical.get(canonicalId);
    const epoch = child?.current;
    if (!child || !epoch?.endpoint || epoch.retired || epoch.cancellation.signal.aborted) {
      throw new EndpointDeliveryError('endpoint_inactive', 'Adapter Endpoint is not active', 'not_sent');
    }
    return { child, epoch, endpoint: epoch.endpoint };
  }

  #lease(canonicalId: CapabilityId, captured: Readonly<{ child: Child<E>; epoch: ChildEpoch<E>; endpoint: E }>, signal?: AbortSignal): EndpointChildLease<E> {
    signal?.throwIfAborted();
    const { child, epoch, endpoint } = captured;
    const runtime = endpointRuntimeOf(endpoint);
    const cancellation = new AbortController();
    const abort = () => cancellation.abort(epoch.cancellation.signal.reason);
    const abortCaller = () => cancellation.abort(signal?.reason);
    epoch.cancellation.signal.addEventListener('abort', abort, { once: true });
    signal?.addEventListener('abort', abortCaller, { once: true });
    epoch.leases += 1;
    let released = false;
    const assertActive = () => {
      if (released || epoch.retired || cancellation.signal.aborted || child.current !== epoch) {
        throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint execution lease is retired', 'not_sent');
      }
    };
    return Object.freeze({
      instanceId: child.desired.instanceId, canonicalId, epoch: epoch.epoch, incarnationId: epoch.incarnationId,
      signal: cancellation.signal, endpoint, assertActive,
      run: async <T>(operation: (endpoint: E, signal: AbortSignal) => T | Promise<T>): Promise<T> => {
        assertActive(); return operation(endpoint, cancellation.signal);
      },
      send: async (request: EndpointSendRequest) => {
        assertActive();
        if (!epoch.started) throw new EndpointDeliveryError('endpoint_inactive', 'Adapter Endpoint is not ready to send', 'not_sent');
        const send = runtime.send;
        if (!this.descriptor.capabilities.includes('outbound') || !send) {
          throw new EndpointDeliveryError('outbound_unsupported', 'Endpoint does not support outbound', 'not_sent');
        }
        const result = await send.call(runtime, { ...request, signal: cancellation.signal });
        if (!isEndpointSendResult(result)) throw new EndpointDeliveryError('delivery_unconfirmed',
          'Endpoint send returned invalid message evidence', 'unknown');
        return result;
      },
      release: () => {
        if (released) return;
        released = true;
        epoch.cancellation.signal.removeEventListener('abort', abort);
        signal?.removeEventListener('abort', abortCaller);
        if (--epoch.leases === 0) epoch.drain?.();
      },
    });
  }

  #assertOpen(): void {
    if (this.#closed) throw new AdapterManagementError('closed', 'Adapter is closed');
  }
  #require(instanceId: string): Child<E> {
    const child = this.#children.get(instanceId);
    if (!child) throw new AdapterManagementError('not_found', 'Endpoint instance does not exist');
    return child;
  }
  #desired(): readonly EndpointDesiredRecord[] { return [...this.#children.values()].map(child => child.desired); }
  #creationConfiguration(endpointId: string, explicit: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const defaults = this.#options.creationDefaults;
    if (defaults === undefined) return explicit;
    return { ...structuredClone(defaults), ...explicit, id: endpointId };
  }
  #replace(instanceId: string, update: (record: EndpointDesiredRecord) => EndpointDesiredRecord): readonly EndpointDesiredRecord[] {
    this.#require(instanceId);
    return this.#desired().map(record => record.instanceId === instanceId ? Object.freeze(update(record)) : record);
  }
  #install(snapshot: EndpointDesiredSnapshot): void {
    assertSnapshot(snapshot);
    const next = new Map<string, Child<E>>();
    for (const desired of snapshot.endpoints) {
      if (desired.canonicalId !== this.descriptor.id && !desired.canonicalId.startsWith(`${this.descriptor.id}~`)) {
        throw new AdapterManagementError('invalid_configuration', 'Endpoint identity belongs to another Adapter');
      }
      // Before restoration these are display-only startup seeds: no Client or lease exists.
      // The first authoritative snapshot replaces them; later installs retain execution identity.
      const existing = this.#repositoryReady ? this.#children.get(desired.instanceId) : undefined;
      if (existing && (existing.desired.canonicalId !== desired.canonicalId || existing.desired.endpointId !== desired.endpointId)) {
        throw new AdapterManagementError('invalid_configuration', 'Existing Endpoint identity cannot change');
      }
      const child = existing ?? { desired, epoch: 0 };
      child.desired = freezeRecord(desired);
      next.set(desired.instanceId, child);
    }
    this.#children.clear();
    this.#canonical.clear();
    for (const [key, child] of next) this.#children.set(key, child);
    for (const child of next.values()) this.#canonical.set(child.desired.canonicalId, child);
    this.#revision = snapshot.revision;
  }
  #mutationResult(execution: ExecutionState): AdapterMutationResult {
    return Object.freeze({ revision: this.#revision, endpoints: this.list(),
      execution: Object.freeze({ status: execution.status, ...(execution.code ? { code: execution.code } : {}) }),
      operation: Object.freeze({ ...execution }),
    });
  }
  #mutate(expectedRevision: number | null, next: () => readonly EndpointDesiredRecord[], apply: (() => Promise<void>) | undefined,
    request: MutationRequest<E>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    this.#assertOpen();
    if (this.#uncertain) throw unknownCommit();
    const repository = this.#options.repository;
    if (!repository || !this.#repositoryReady) throw new AdapterManagementError('unavailable', 'Endpoint desired repository is unavailable or not activated');
    if (this.#mutation || this.#revision !== expectedRevision) {
      throw new AdapterManagementError('conflict', 'Endpoint desired state revision conflicts');
    }
    const endpoints = next();
    assertSnapshot({ revision: expectedRevision ?? 0, endpoints });
    const commitId = randomUUID();
    const commit = Promise.resolve().then(async () => {
      options?.beforeCommit?.();
      let committed: EndpointDesiredSnapshot;
      try { committed = await repository.compareAndSet(this.descriptor.id, expectedRevision, endpoints, commitId); }
      catch (error) {
        if (!(error instanceof AdapterManagementError) || error.code === 'commit_unknown') {
          this.#uncertain = { commitId, revision: (expectedRevision ?? 0) + 1, endpoints, request, apply };
        }
        throw error;
      }
      this.#install(committed);
      return committed;
    });
    this.#mutation = commit;
    const admitted = commit.then(committed => {
      if (this.#mutation === commit) this.#mutation = undefined;
      return this.#admit(committed, apply, request);
    });
    void admitted.catch(() => {
      if (this.#mutation === commit) this.#mutation = undefined;
    });
    return admitted.then(({ execution, completion }) => options?.waitForExecution === false
      ? this.#mutationResult(execution) : completion);
  }

  #admit(committed: EndpointDesiredSnapshot, apply: (() => Promise<void>) | undefined, request: MutationRequest<E>) {
    const execution: ExecutionState = { instanceId: request.instanceId, action: request.action,
      revision: committed.revision, status: apply ? 'pending' : 'applied' };
    const child = this.#children.get(request.instanceId) ?? request.child;
    if (child) child.execution = execution;
    this.#lastMutation = execution;
    // Membership may have gone away, but actual SDK ownership must survive until cleanup succeeds.
    if (request.child?.current && (request.action === 'remove' || request.action === 'replace')) {
      request.child.current.execution = execution;
      this.#retiredEpochs.add(request.child.current);
    }
    const completion = Promise.resolve().then(async () => {
      try {
        if (this.#closed) { execution.status = 'failed'; execution.code = 'adapter_closed'; }
        else { await apply?.(); execution.status = 'applied'; }
      } catch { execution.status = 'failed'; execution.code = 'endpoint_execution_failed'; }
      return this.#mutationResult(execution);
    });
    this.#operations.add(completion);
    void completion.finally(() => this.#operations.delete(completion)).catch(() => undefined);
    return { execution, completion };
  }

  async #prepare(child: Child<E>, signal?: AbortSignal): Promise<ChildEpoch<E>> {
    if (child.current && !child.current.retired) {
      await child.current.preparation;
      return child.current;
    }
    const cancellation = new AbortController();
    const epoch: ChildEpoch<E> = { identity: metadata(child.desired), incarnationId: randomUUID(), epoch: ++child.epoch, cancellation, operations: [], started: false,
      open: false, retired: false, startAttempted: false, leases: 0 };
    child.current = epoch;
    const abort = () => cancellation.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const preparation = Promise.resolve().then(async () => {
      cancellation.signal.throwIfAborted();
      const config: Record<string, unknown> = structuredClone(child.desired.config);
      for (const [field, reference] of Object.entries(child.desired.secretRefs ?? {})) {
        if (!this.#options.secrets) throw new AdapterManagementError('unavailable', 'Endpoint secret resolver is unavailable');
        config[field] = await this.#options.secrets.resolve(reference, { instanceId: child.desired.instanceId, signal: cancellation.signal });
      }
      const endpoint = await this.createEndpoint(config as Config, {
        signal: cancellation.signal, epoch: epoch.epoch, incarnationId: epoch.incarnationId, instanceId: child.desired.instanceId,
        canonicalId: child.desired.canonicalId, endpointId: child.desired.endpointId,
      });
      epoch.endpoint = endpoint;
      epoch.operations = this.#options.bind(endpoint, child.desired, cancellation.signal);
      if (epoch.retired || cancellation.signal.aborted || this.#closed) {
        cancellation.signal.throwIfAborted();
        throw new AdapterManagementError('closed', 'Endpoint creation retired');
      }
    });
    epoch.preparation = preparation;
    try { await preparation; return epoch; }
    catch (error) { await this.#stopEpoch(epoch); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  async #start(child: Child<E>, signal?: AbortSignal): Promise<void> {
    // Reuse the owned close result; a new SDK for this identity requires successful cleanup.
    if (child.current?.retired) await child.current.closing;
    this.#assertOpen();
    if (this.#children.get(child.desired.instanceId) !== child || !child.desired.desiredEnabled) {
      throw new AdapterManagementError('inactive', 'Endpoint is no longer owned and enabled by this Adapter');
    }
    const epoch = await this.#prepare(child, signal);
    if (epoch.started || epoch.retired) return;
    epoch.execution = child.execution;
    epoch.starting ??= Promise.resolve().then(() => this.#startEpoch(child, epoch, signal));
    await epoch.starting;
  }
  async #startEpoch(child: Child<E>, epoch: ChildEpoch<E>, signal?: AbortSignal): Promise<void> {
    const endpoint = epoch.endpoint;
    if (!endpoint) throw new AdapterManagementError('integrity', 'Endpoint factory did not transfer an instance');
    epoch.startAttempted = true;
    const abort = () => epoch.cancellation.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let rejectCancellation!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const onCancel = () => {
      void this.#stopEpoch(epoch).then(() => rejectCancellation(epoch.cancellation.signal.reason), rejectCancellation);
    };
    epoch.cancellation.signal.addEventListener('abort', onCancel, { once: true });
    try {
      await Promise.race([Promise.resolve().then(() => {
        epoch.cancellation.signal.throwIfAborted();
        return endpointRuntimeOf(endpoint).start(epoch.cancellation.signal);
      }), cancelled]);
      epoch.cancellation.signal.throwIfAborted();
      epoch.started = true;
      this.#open(child);
    } catch (error) {
      try { await this.#stopEpoch(epoch); } catch (cleanupError) {
        throw new GenerationCompensationError([error, cleanupError], 'Endpoint start and cleanup both failed', { cause: cleanupError });
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      epoch.cancellation.signal.removeEventListener('abort', onCancel);
    }
  }
  #open(child: Child<E>): void {
    const epoch = child.current;
    if (!this.#admission || !epoch?.endpoint || !epoch.started || epoch.retired || epoch.open) return;
    endpointRuntimeOf(epoch.endpoint).open();
    epoch.open = true;
  }
  #stop(child: Child<E>): Promise<void> {
    if (!child.current) return Promise.resolve();
    child.current.execution = child.execution;
    return this.#stopEpoch(child.current);
  }
  #stopEpoch(epoch: ChildEpoch<E>): Promise<void> {
    if (epoch.closing) return epoch.closing;
    this.#retiredEpochs.add(epoch);
    epoch.retired = true;
    const wasOpen = epoch.open;
    epoch.open = false;
    if (epoch.endpoint) retireEndpoint(endpointRuntimeOf(epoch.endpoint));
    // Publish the cleanup promise before abort callbacks can reenter stop().
    const cleanup = Promise.resolve().then(async () => {
      await epoch.preparation?.catch(() => undefined);
      const errors: unknown[] = [];
      if (wasOpen) { try { await (epoch.endpoint ? endpointRuntimeOf(epoch.endpoint).close() : undefined); } catch (error) { errors.push(error); } }
      if (epoch.leases !== 0) await new Promise<void>(resolve => { epoch.drain = resolve; });
      try { await (epoch.endpoint ? endpointRuntimeOf(epoch.endpoint).stop() : undefined); } catch (error) { errors.push(error); }
      finally {
        try { if (epoch.endpoint) this.endpointDisposed(epoch.endpoint); } catch (error) { errors.push(error); }
      }
      if (errors.length) { epoch.cleanupFailed = true; throw new AggregateError(errors, 'Endpoint cleanup failed'); }
      this.#retiredEpochs.delete(epoch);
    });
    epoch.closing = cleanup;
    epoch.cancellation.abort(new AdapterManagementError('inactive', 'Endpoint execution retired'));
    return cleanup;
  }
  #view(child: Child<E>): EndpointChildView<E> {
    const current = child.current;
    return Object.freeze({ desired: metadata(child.desired), endpoint: current?.endpoint, epoch: child.epoch,
      ...(current ? { incarnationId: current.incarnationId } : {}),
      operations: current?.operations ?? [], started: current?.started ?? false, open: current?.open ?? false,
      stopped: current?.retired ?? false, startAttempted: current?.startAttempted ?? false });
  }
}

function metadata(record: EndpointDesiredRecord): import('./adapter-types.js').EndpointDesiredMetadata {
  const { config: _config, secretRefs: _secretRefs, ...view } = record;
  return Object.freeze(view);
}
function freezeRecord(record: EndpointDesiredRecord): EndpointDesiredRecord {
  return Object.freeze({ ...record, config: Object.freeze(structuredClone(record.config)),
    ...(record.secretRefs ? { secretRefs: Object.freeze({ ...record.secretRefs }) } : {}) });
}
function assertSnapshot(snapshot: EndpointDesiredSnapshot): void {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new AdapterManagementError('invalid_configuration', 'Invalid repository revision');
  const names = new Set<string>(), ids = new Set<string>(), canonical = new Set<string>();
  for (const record of snapshot.endpoints) {
    if (!record.instanceId || !record.canonicalId || !record.endpointId || /[~\0]/u.test(record.endpointId)
      || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.desiredEnabled !== 'boolean') {
      throw new AdapterManagementError('invalid_configuration', 'Invalid endpoint desired record');
    }
    if (names.has(record.endpointId) || ids.has(record.instanceId) || canonical.has(record.canonicalId)) {
      throw new AdapterManagementError('duplicate_entry', 'Endpoint identity or name is duplicated');
    }
    names.add(record.endpointId); ids.add(record.instanceId); canonical.add(record.canonicalId);
  }
}
function isEndpointSendResult(value: unknown): value is EndpointSendResult {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object' || !('parts' in value) || !Array.isArray(value.parts) || !value.parts.length) return false;
  return value.parts.every((part: unknown) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
    const { messageId, sourceIndices } = part as { messageId?: unknown; sourceIndices?: unknown };
    return (messageId === undefined || (typeof messageId === 'string' && messageId.trim().length > 0))
      && (sourceIndices === undefined || (Array.isArray(sourceIndices)
        && sourceIndices.every(index => Number.isSafeInteger(index) && index >= 0)));
  });
}

/** Erased public runtime surface; platform registries retain the concrete subclass type. */
export type AdapterInstance = Pick<Adapter<AnyEndpoint, unknown, object>, keyof Adapter<AnyEndpoint, unknown, object>>;

function unknownCommit(): AdapterManagementError {
  return new AdapterManagementError('commit_unknown', 'Endpoint desired state commit is unknown; refresh before another operation');
}

function assertEndpointSource(endpoint: AnyEndpoint, expectedClient: unknown): void {
  if (endpointClientOf(endpoint) !== expectedClient) {
    throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint source incarnation is retired', 'not_sent');
  }
}

function samePersistedRecords(left: readonly EndpointDesiredRecord[], right: readonly EndpointDesiredRecord[]): boolean {
  // Compare the complete persisted document; JSON storage omits optional undefined fields.
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
}
