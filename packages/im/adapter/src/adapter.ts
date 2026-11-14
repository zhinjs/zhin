import { redactConfigurationUrl } from './configuration-metadata.js';
import { AsyncResource } from 'node:async_hooks';
import { setMaxListeners } from 'node:events';
import { sameConfigurationIdentity } from './configuration-identity.js';
import { readConfigurationPath, writeConfigurationPath } from './configuration-fields.js';
import { configuredSelfProfile, endpointCreationConfiguration, isEndpointProfileConfigurationChange, type SelfProfile } from './endpoint-profile.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EndpointDeliveryError, SELF_PROFILE_FIELDS } from '@zhin.js/im-contract';
import { DisposeStack, GenerationCompensationError, type CapabilityId } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { retireEndpoint, isEndpoint, endpointRuntimeOf, type AnyEndpoint } from './endpoint-specification.js';
import type { EndpointSendRequest, EndpointSendResult } from './endpoint-contract.js';
import type { EndpointMessageStream, EndpointStreamRequest, EndpointStreaming } from './endpoint-stream.js';
import {
  AdapterManagementError,
  type AdapterDescriptorInfo, type EndpointChildLease, type EndpointChildView,
  type EndpointDesiredRecord, type EndpointDesiredRepository, type EndpointDesiredSnapshot,
  type EndpointCreationContext, type EndpointPreviousIdentity, type EndpointMetadata, type AdapterMutationResult, type EndpointSecretResolver,
  type EndpointExecution, type EndpointAction, type AdapterMutationOptions, type EndpointConfigurationView,
  type EndpointStartFailure, type EndpointStartPhase, type EndpointFailureCategory,
} from './adapter-types.js';
import {
  compareEndpointDirectories, configuredEndpointSeeds, endpointWritebackEntry, splitEnvironmentReferences,
  type EndpointConfigDrift, type EndpointConfigSource, type EndpointWritebackPlaceholder,
} from './endpoint-config-drift.js';

const logger = getLogger('adapter');
/** How long activation waits for account starts before the generation commits without them. */
export const DEFAULT_ENDPOINT_START_GRACE_MS = 3_000;
/** Automatic start retry backoff: 5s doubling to 5min, ±20% jitter, unlimited attempts. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const RETRY_JITTER = 0.2;

type ExecutionState = { -readonly [K in keyof EndpointExecution]: EndpointExecution[K] };
interface ChildEpoch<E extends AnyEndpoint> {
  readonly incarnationId: string;
  readonly identity: import('./adapter-types.js').EndpointDesiredMetadata;
  execution?: ExecutionState;
  cleanupFailed?: boolean;
  /** Credential values resolved for this epoch, only to mask them in failure messages. */
  secrets?: readonly string[];
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
/** Background start supervision of one account; never part of a generation transaction. */
interface StartState {
  attempt: number;
  failure?: EndpointStartFailure;
  /** Last failure's raw message with this account's credentials masked (the warn log text); host-only. */
  reason?: string;
  phase?: EndpointStartPhase;
  nextRetryAt?: number;
}
interface Child<E extends AnyEndpoint> {
  desired: EndpointDesiredRecord;
  epoch: number;
  current?: ChildEpoch<E>;
  execution?: ExecutionState;
  /** Token of the current supervision loop; stop/replace/update/dispose invalidate it. */
  supervision: number;
  /** Whether a supervision loop (attempt or retry wait) is running. */
  supervising?: boolean;
  /** Wakes the current retry wait early (stop cancels it, relogin retries immediately). */
  retry?: AbortController;
  start?: StartState;
}
interface MutationRequest<E extends AnyEndpoint> {
  readonly instanceId: string;
  readonly action: EndpointAction;
  readonly child?: Child<E>;
}
/** A single account change keeps its prepared state and corresponding execution together. */
interface PreparedAdapterChange<E extends AnyEndpoint> {
  readonly expectedRevision: number | null;
  /** Evaluated after admission validation, then frozen before the single CAS. */
  readonly next: () => readonly EndpointDesiredRecord[];
  readonly execution: MutationRequest<E> & Readonly<{ run?: () => Promise<void> }>;
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
  /** Stored configuration file, for `zhin.config.yml` drift, import and write-back (#1250). */
  readonly configSource?: EndpointConfigSource;
  /** Captured startup connection defaults, used only once for newly added/replaced accounts. */
  readonly creationDefaults?: Readonly<Record<string, unknown>>;
  /** @internal Activation grace for account starts (default {@link DEFAULT_ENDPOINT_START_GRACE_MS}). */
  readonly startGraceMs?: number;
}

/** Owns desired state and each child execution epoch. AdapterIndex is a read/routing projection. */
export abstract class Adapter<E extends AnyEndpoint = AnyEndpoint, Config = Readonly<Record<string, unknown>>, Events extends object = Record<string, unknown>> {
  declare readonly adapterEvents: Events;
  protected validateConfiguration(_config: Config): void {}
  /** Platforms must explicitly declare fields safe to update and fields defining identity. */
  get configurationUpdateFields(): readonly string[] | undefined { return undefined; }
  get configurationIdentityFields(): readonly string[] | undefined { return undefined; }
  /** Opaque identity-bearing credential paths; changes require verified read-only identity. */
  get configurationIdentityProbeFields(): readonly string[] { return []; }
  /**
   * Credential paths whose values are masked in start-failure reasons (besides credential-like key
   * names and resolved `${VAR}` references). Defaults to the identity probe fields; platforms with
   * credentials under other names (e.g. a `buvid3` cookie) list them here.
   */
  get configurationCredentialFields(): readonly string[] { return this.configurationIdentityProbeFields; }
  protected identifyConfiguration(_config: Config, _signal: AbortSignal,
    _changedFields: readonly string[]): Promise<string | undefined> { return Promise.resolve(undefined); }
  /** Pure per-account resource configuration; only used for fresh add/replace identities. */
  protected prepareConfiguration(config: Config, _identity: Readonly<{
    instanceId: string; canonicalId: CapabilityId; endpointId: string;
  }>): Config { return config; }

  /** Platform-owned login completion, after read-only identity verification and before changing live credentials. */
  protected async acceptVerifiedLogin(context: EndpointCreationContext, input: Readonly<{
    userId: string; config: Config; previousIdentity: EndpointPreviousIdentity; signal?: AbortSignal;
  }>): Promise<'retained' | 'replaced'> {
    const child = this.#require(context.instanceId), epoch = child.current;
    if (!epoch?.endpoint || epoch.retired || epoch.epoch !== context.epoch
      || epoch.incarnationId !== context.incarnationId || child.desired.canonicalId !== context.canonicalId) {
      throw new AdapterManagementError('inactive', 'Login belongs to a retired account incarnation');
    }
    const signal = input.signal ? AbortSignal.any([context.signal, input.signal]) : context.signal;
    signal.throwIfAborted();
    if (!input.userId.trim()) throw new AdapterManagementError('invalid_configuration', 'Verified platform identity is required');
    if (this.needsMigration) throw new AdapterManagementError('conflict', 'Account migration must be confirmed before saving login credentials');
    this.validateConfiguration(input.config);
    const previousUserId = child.desired.platformUserId ?? endpointRuntimeOf(epoch.endpoint).selfUserId
      ?? (input.previousIdentity.kind === 'verified' ? input.previousIdentity.userId : undefined);
    if (previousUserId === undefined && input.previousIdentity.kind === 'unknown') {
      throw new AdapterManagementError('unsupported', 'Previous account identity is unknown; use explicit replacement');
    }
    const options: AdapterMutationOptions = { signal, waitForExecution: false, beforeCommit: () => signal.throwIfAborted() };
    if (previousUserId !== undefined && previousUserId !== input.userId) {
      await this.replace(context.instanceId, this.#revision, { endpointId: child.desired.endpointId,
        config: input.config as Readonly<Record<string, unknown>> }, options);
      return 'replaced';
    }
    await this.#commit({
      expectedRevision: this.#revision,
      next: () => this.#replace(context.instanceId, record => ({
        ...record, config: input.config as Readonly<Record<string, unknown>>,
        platformUserId: input.userId, revision: record.revision + 1,
      })),
      execution: { instanceId: context.instanceId, action: 'update', child },
    }, options);
    return 'retained';
  }

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
  readonly #verificationAbort = new AbortController();
  /** Adapter lifetime: background start supervision ends with dispose, never with a transaction. */
  readonly #lifetime = unboundedAbortController();
  #admission = false;
  #repositoryReady = false;
  #restoration?: Promise<void>;
  #mutation?: Promise<unknown>;
  #uncertain?: UncertainMutation<E>;
  #verification?: Promise<void>;
  readonly #operations = new Set<Promise<unknown>>();
  // Account jobs belong to the Adapter, not the SDK callback which submitted them.
  readonly #executionScope = new AsyncResource('zhin.adapter.execution');
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
      if (loaded !== undefined) this.#reportConfigDrift();
    });
    await this.#restoration;
  }

  /** Startup / reload notice: account ids and difference kinds only, never values. */
  #reportConfigDrift(): void {
    if (!this.#options.configSource) return;
    void this.configDrift().then(drift => {
      if (!drift.entries.length) return;
      const ids = (kind: string) => drift.entries.filter(entry => entry.kind === kind).map(entry => entry.id);
      const changed = drift.entries.filter(entry => entry.kind === 'changed')
        .map(entry => `${entry.id}(${(entry.fields ?? []).map(field => field.path).join('|')})`);
      logger.warn(formatCompact({ op: 'endpoint_config_drift', adapter: this.descriptor.name,
        ...(ids('config_only').length ? { configOnly: ids('config_only').join(',') } : {}),
        ...(ids('snapshot_only').length ? { savedOnly: ids('snapshot_only').join(',') } : {}),
        ...(changed.length ? { changed: changed.join(',') } : {}),
        hint: 'saved accounts win over zhin.config.yml endpoints; import or write back in the Console' }));
    }, () => undefined);
  }

  /**
   * `zhin.config.yml` `endpoints` versus the persisted accounts (#1250): ids and paths only.
   * `authority: 'config'` while no snapshot exists (the file still seeds the accounts).
   */
  async configDrift(options: Readonly<{ signal?: AbortSignal; sensitiveFields?: readonly string[] }> = {}): Promise<EndpointConfigDrift> {
    this.#assertOpen();
    const source = this.#options.configSource;
    if (!source) throw new AdapterManagementError('unsupported', 'Endpoint configuration source is unavailable');
    if (this.#options.repository && !this.#repositoryReady) {
      throw new AdapterManagementError('unavailable', 'Endpoint desired state is not restored yet');
    }
    if (!this.#options.repository || this.#revision === null) {
      return Object.freeze({ authority: 'config', revision: this.#revision, entries: Object.freeze([]), unverified: Object.freeze([]) });
    }
    const revision = this.#revision;
    const records = this.#desired();
    const document = await source.read(this.descriptor.owner, options.signal);
    const seeds = configuredEndpointSeeds(document.config, this.descriptor.name, source.resolveIdentifier?.bind(source));
    const { entries, unverified } = compareEndpointDirectories(seeds, records, this.#secretKey(source, options.sensitiveFields),
      source.resolveReference?.bind(source));
    return Object.freeze({ authority: 'snapshot', revision, configRevision: document.revision, entries, unverified });
  }

  /**
   * Import one `zhin.config.yml` account into the persisted directory (#1250): `${VAR}` values
   * become `secretRefs` (resolved at start, never stored resolved). An account already persisted
   * under that id takes the file's configuration (identity kept); one whose identity fields
   * (`configurationIdentityFields` / `configurationIdentityProbeFields`) differ in the file is refused
   * (`invalid_configuration`: replace it instead). A new one is added. The configuration is prepared
   * (`prepareConfiguration`) and validated (`validateConfiguration`) like `add` / `update`. `start`
   * also enables and starts it.
   */
  importConfigured(endpointId: string, expectedRevision: number | null,
    options: AdapterMutationOptions & Readonly<{ start?: boolean }> = {}): Promise<AdapterMutationResult> {
    this.#assertOpen();
    const source = this.#options.configSource;
    if (!source) throw new AdapterManagementError('unsupported', 'Endpoint configuration source is unavailable');
    if (!this.canManage) throw new AdapterManagementError('unavailable', 'Endpoint desired repository is unavailable');
    if (this.#revision !== expectedRevision) throw new AdapterManagementError('conflict', 'Endpoint desired state revision conflicts');
    const { start, ...mutation } = options;
    return source.read(this.descriptor.owner, options.signal).then(document => {
      const seed = configuredEndpointSeeds(document.config, this.descriptor.name, source.resolveIdentifier?.bind(source))
        .find(value => value.endpointId === endpointId);
      if (!seed) throw new AdapterManagementError('not_found', 'The configuration file has no such account');
      const split = splitEnvironmentReferences(seed.config);
      const secretRefs = split.secretRefs;
      configuredSelfProfile(split.config);
      const existing = [...this.#children.values()].find(child => child.desired.endpointId === endpointId);
      if (existing) {
        const instanceId = existing.desired.instanceId;
        // Importing over an account keeps its identity (instanceId / canonicalId / platformUserId):
        // a file entry naming another platform account must go through an explicit replacement.
        const identity = [...(this.configurationIdentityFields ?? []), ...this.configurationIdentityProbeFields];
        const identityChanged = identity.some(field =>
          !isDeepStrictEqual(readConfigurationPath(existing.desired.config, field), readConfigurationPath(split.config, field))
          || existing.desired.secretRefs?.[field] !== secretRefs?.[field]);
        if (identityChanged) {
          throw new AdapterManagementError('invalid_configuration',
            'The configuration file changes this account\'s identity; replace the account (or remove it and import it again) instead of importing over it');
        }
        const config = this.prepareConfiguration(structuredClone(split.config) as Config, {
          instanceId, endpointId, canonicalId: existing.desired.canonicalId,
        }) as Readonly<Record<string, unknown>>;
        this.validateConfiguration(config as Config);
        return this.#commit({
          expectedRevision,
          next: () => this.#replace(instanceId, record => {
            const { secretRefs: _previous, ...rest } = record;
            return { ...rest, config, ...(secretRefs ? { secretRefs } : {}),
              desiredEnabled: start === true ? true : record.desiredEnabled, revision: record.revision + 1 };
          }),
          execution: { instanceId, action: start === true ? 'start' : 'update', child: existing, run: async () => {
            const child = this.#require(instanceId);
            await this.#stop(child);
            if (child.desired.desiredEnabled) await this.#supervise(child, { restart: true });
          } },
        }, mutation);
      }
      const seedId = (seed.singleton ? this.descriptor.id : `${this.descriptor.id}~${endpointId}`) as CapabilityId;
      const taken = this.#children.has(seedId) || this.#canonical.has(seedId);
      const instanceId = taken ? randomUUID() : String(seedId);
      const canonicalId = (taken ? `${this.descriptor.id}~${instanceId}` : seedId) as CapabilityId;
      const config = this.prepareConfiguration(structuredClone(split.config) as Config, { instanceId, endpointId, canonicalId }) as
        Readonly<Record<string, unknown>>;
      this.validateConfiguration(config as Config);
      const record: EndpointDesiredRecord = Object.freeze({ instanceId, canonicalId,
        endpointId, revision: 1, desiredEnabled: start === true, config, ...(secretRefs ? { secretRefs } : {}) });
      return this.#commit({
        expectedRevision,
        next: () => [...this.#desired(), record],
        execution: { instanceId, action: 'add',
          ...(start === true ? { run: () => this.#supervise(this.#require(instanceId), { restart: true }) } : {}) },
      }, mutation);
    });
  }

  /**
   * Write persisted accounts back into `zhin.config.yml` `endpoints` (#1250). Credentials are
   * written as `${VAR}` references only: the reference the file already had, else a placeholder
   * returned in `placeholders` for the operator to set in `.env`. The persisted accounts are not
   * changed. Single-account instance blocks (no `endpoints` list) are not rewritten.
   */
  async writeBackConfigured(endpointIds: readonly string[], options: Readonly<{
    signal?: AbortSignal; sensitiveFields?: readonly string[];
  }> = {}): Promise<Readonly<{ revision: string; written: readonly string[]; placeholders: readonly EndpointWritebackPlaceholder[];
    missingEnv: readonly string[] }>> {
    this.#assertOpen();
    const source = this.#options.configSource;
    if (!source) throw new AdapterManagementError('unsupported', 'Endpoint configuration source is unavailable');
    if (!this.canManage || this.#revision === null) {
      throw new AdapterManagementError('conflict', 'No saved accounts yet: the configuration file is still authoritative');
    }
    const ids = [...new Set(endpointIds)];
    if (!ids.length || ids.some(id => typeof id !== 'string' || !id)) throw new AdapterManagementError('invalid_configuration', 'Account ids are required');
    const document = await source.read(this.descriptor.owner, options.signal);
    const block = document.config ?? {};
    if (block.endpoints !== undefined && !Array.isArray(block.endpoints)) {
      throw new AdapterManagementError('invalid_configuration', 'endpoints must be a list');
    }
    const current = (block.endpoints ?? []) as readonly unknown[];
    const { endpoints: _endpoints, ...base } = block;
    const resolveIdentifier = source.resolveIdentifier?.bind(source);
    const resolveId = (value: unknown) => typeof value !== 'string' ? undefined
      : (value.includes('${') && resolveIdentifier ? resolveIdentifier(value) : value).trim();
    const isSecretKey = this.#secretKey(source, options.sensitiveFields);
    const entries = current.map(entry => entry);
    const placeholders: EndpointWritebackPlaceholder[] = [];
    for (const id of ids) {
      const child = [...this.#children.values()].find(value => value.desired.endpointId === id);
      if (!child) throw new AdapterManagementError('not_found', 'No saved account has this id');
      if (child.desired.canonicalId === this.descriptor.id) {
        throw new AdapterManagementError('unsupported', 'Single-account configuration blocks are edited directly');
      }
      const index = entries.findIndex(entry => !!entry && typeof entry === 'object' && resolveId((entry as { id?: unknown }).id) === id);
      const existing = index >= 0 ? entries[index] as Readonly<Record<string, unknown>> : undefined;
      const written = endpointWritebackEntry({ adapter: this.descriptor.name, record: child.desired, existing, base,
        isSecretKey, resolveIdentifier, ...(source.resolveReference ? { resolveReference: source.resolveReference.bind(source) } : {}) });
      placeholders.push(...written.placeholders);
      if (index >= 0) entries[index] = written.entry; else entries.push(written.entry);
    }
    options.signal?.throwIfAborted();
    const result = await source.writeEndpoints(this.descriptor.owner,
      entries as readonly Readonly<Record<string, unknown>>[], document.revision, options.signal);
    return Object.freeze({ revision: result.revision, written: Object.freeze(ids), placeholders: Object.freeze(placeholders),
      missingEnv: Object.freeze([...(result.missingEnv ?? [])]) });
  }

  #secretKey(source: EndpointConfigSource, sensitiveFields: readonly string[] = []): (key: string) => boolean {
    const declared = new Set(sensitiveFields.map(field => field.split('.').at(-1) ?? field));
    return key => declared.has(key) || (source.isSecretKey ? source.isSecretKey(key)
      : /(?:password|passwd|secret|apikey|accesskey|privatekey|credential|authorization|cookie|token$)/u
        .test(key.replace(/[^a-z0-9]/giu, '').toLowerCase()));
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
      ...startFacts(child),
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
      startAttempt: 0, retiring: true, removed: !this.#children.has(epoch.identity.instanceId),
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
        const value = readConfigurationPath(child.desired.config, field.key);
        if (value === undefined && !child.desired.secretRefs?.[field.key]) continue;
        if (field.secret || field.env || child.desired.secretRefs?.[field.key]) values[field.key] = '••••••';
        else if (value !== undefined && value !== null) values[field.key] = typeof value === 'string' ? redactConfigurationUrl(field.key, value) : JSON.stringify(value);
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
    const instanceId = randomUUID();
    const config = this.#newConfiguration(input.endpointId, input.config, instanceId);
    this.validateConfiguration(config as Config);
    return this.#commit({
      expectedRevision,
      next: () => {
        const record: EndpointDesiredRecord = Object.freeze({ ...input, config, instanceId,
          canonicalId: `${this.descriptor.id}~${instanceId}` as CapabilityId,
          revision: 1, desiredEnabled: false });
        return [...this.#desired(), record];
      },
      execution: { instanceId, action: 'add' },
    }, options);
  }

  update(instanceId: string, expectedRevision: number | null, candidate: Readonly<{
    config: Readonly<Record<string, unknown>>; secretRefs?: Readonly<Record<string, string>>;
  }>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const input = structuredClone(candidate);
    const target = this.#require(instanceId);
    for (const field of this.configurationIdentityFields ?? []) {
      if (!isDeepStrictEqual(readConfigurationPath(target.desired.config, field), readConfigurationPath(input.config, field))) {
        throw new AdapterManagementError('invalid_configuration', 'Account identity changes require explicit replacement');
      }
    }
    configuredSelfProfile(input.config);
    this.validateConfiguration(input.config as Config);
    const profileOnly = isEndpointProfileConfigurationChange(target.desired.config, input.config)
      && isDeepStrictEqual(target.desired.secretRefs ?? {}, input.secretRefs ?? {});
    const commit = () => this.#commit({
      expectedRevision,
      next: () => this.#replace(instanceId, record => ({
        ...record, config: input.config, secretRefs: input.secretRefs, revision: record.revision + 1,
      })),
      execution: {
        instanceId, action: 'update', child: target,
        ...(profileOnly ? {} : { run: async () => {
          const child = this.#require(instanceId);
          await this.#stop(child);
          if (child.desired.desiredEnabled) await this.#supervise(child);
        } }),
      },
    }, options);
    const changedFields = this.configurationIdentityProbeFields.filter(field =>
      !isDeepStrictEqual(readConfigurationPath(target.desired.config, field), readConfigurationPath(input.config, field))
      || target.desired.secretRefs?.[field] !== input.secretRefs?.[field]);
    if (!changedFields.length) return commit();
    this.#assertOpen();
    if (!this.canManage) throw new AdapterManagementError('unavailable', 'Endpoint desired repository is unavailable');
    if (this.#uncertain) throw unknownCommit();
    if (this.#mutation || this.#revision !== expectedRevision) throw new AdapterManagementError('conflict', 'Endpoint desired state revision conflicts');
    const signal = options?.signal ? AbortSignal.any([options.signal, this.#verificationAbort.signal]) : this.#verificationAbort.signal;
    return sameConfigurationIdentity<Config>({ previous: target.desired, next: input, changedFields, signal,
      secrets: this.#options.secrets, identify: (config, signal, changed) => this.identifyConfiguration(config, signal, changed),
    }).then(same => {
      signal.throwIfAborted();
      return same ? commit() : this.replace(instanceId, expectedRevision, { endpointId: target.desired.endpointId, ...input }, options);
    });
  }

  start(instanceId: string, expectedRevision: number | null, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const target = this.#require(instanceId);
    return this.#commit({
      expectedRevision,
      next: () => this.#replace(instanceId, record => ({
        ...record, desiredEnabled: true, revision: record.revision + 1,
      })),
      execution: { instanceId, action: 'start', child: target, run: () => this.#supervise(target, { restart: true }) },
    }, options);
  }
  stop(instanceId: string, expectedRevision: number | null, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const target = this.#require(instanceId);
    return this.#commit({
      expectedRevision,
      next: () => this.#replace(instanceId, record => ({
        ...record, desiredEnabled: false, revision: record.revision + 1,
      })),
      execution: { instanceId, action: 'stop', child: target, run: () => this.#stop(target) },
    }, options);
  }
  remove(instanceId: string, expectedRevision: number | null, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const child = this.#require(instanceId);
    return this.#commit({
      expectedRevision,
      next: () => this.#desired().filter(record => record.instanceId !== instanceId),
      execution: { instanceId, action: 'remove', child, run: () => this.#stop(child) },
    }, options);
  }

  /** One desired-state CAS replaces identity; it never inherits the old enabled intent. */
  replace(instanceId: string, expectedRevision: number | null, input: Readonly<{
    endpointId: string; config: Readonly<Record<string, unknown>>; secretRefs?: Readonly<Record<string, string>>;
  }>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const child = this.#require(instanceId);
    const replacementId = randomUUID();
    const config = this.#newConfiguration(input.endpointId, input.config, replacementId);
    this.validateConfiguration(config as Config);
    const record: EndpointDesiredRecord = Object.freeze({ ...input, config, instanceId: replacementId,
      canonicalId: `${this.descriptor.id}~${replacementId}` as CapabilityId, revision: 1, desiredEnabled: false });
    return this.#commit({
      expectedRevision,
      next: () => this.#desired().map(value => value.instanceId === instanceId ? record : value),
      execution: { instanceId, action: 'replace', child, run: () => this.#stop(child) },
    }, options);
  }

  patchConfiguration(instanceId: string, expectedRevision: number | null, patch: Readonly<Record<string, unknown>>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const allowed = this.configurationUpdateFields;
    const common = ['nickname', 'profile', ...SELF_PROFILE_FIELDS.filter(field => field !== 'nickname').map(field => `profile.${field}`)];
    if (!allowed && (!Object.keys(patch).length || Object.keys(patch).some(key => !common.includes(key)))) {
      throw new AdapterManagementError('unsupported', 'This Adapter does not declare safe configuration updates');
    }
    for (const key of Object.keys(patch)) if (!common.includes(key) && !allowed?.includes(key)) {
      throw new AdapterManagementError('invalid_configuration', 'The field is not updateable; identity changes require explicit replacement');
    }
    const previous = this.#require(instanceId).desired;
    const secretRefs = { ...previous.secretRefs };
    for (const key of Object.keys(patch)) delete secretRefs[key];
    const config = structuredClone(previous.config) as Record<string, unknown>;
    for (const [field, value] of Object.entries(patch)) writeConfigurationPath(config, field, value);
    return this.update(instanceId, expectedRevision, { config, secretRefs }, options);
  }

  /** @internal Public profile fields only; connection data and credentials never leave their owner. */
  configuredProfile(instanceId: string): Readonly<SelfProfile> {
    return configuredSelfProfile(this.#require(instanceId).desired.config);
  }

  /**
   * Starts every enabled account in the background and waits at most the start grace period.
   * Account start failures never reject activation (they are retried per account, see
   * {@link Adapter.retryStart}); only cancellation of `signal` does.
   *
   * `awaitStarts` (tools and tests that exercise one Endpoint's own start contract) instead waits
   * for every first attempt and rejects with the first failure, as `Endpoint.start()` threw it;
   * the caller then disposes the Adapter, which also ends the scheduled retries.
   */
  async activate(signal: AbortSignal, options: Readonly<{ awaitStarts?: boolean }> = {}): Promise<void> {
    this.#assertOpen();
    await this.#restore(signal);
    const attempts: Promise<void>[] = [];
    for (const child of this.#children.values()) {
      if (child.desired.desiredEnabled) attempts.push(this.#supervise(child));
    }
    const settled = Promise.allSettled(attempts);
    if (attempts.length) await graceWait(settled, options.awaitStarts ? Infinity
      : this.#options.startGraceMs ?? DEFAULT_ENDPOINT_START_GRACE_MS, signal);
    signal.throwIfAborted();
    if (!options.awaitStarts) return;
    const failure = (await settled).find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason instanceof EndpointStartAttemptError ? failure.reason.cause : failure.reason;
  }

  /**
   * @internal Host startup report only (`zhin start --once`): the last start failure of a not-online
   * account as its raw message with this account's credentials masked — the text the
   * `endpoint_start_failed` warn log already carries. Never part of metadata, Console or RPC results.
   */
  startFailureReason(canonicalId: CapabilityId): string | undefined {
    const child = this.#canonical.get(canonicalId);
    return child?.start?.failure ? child.start.reason : undefined;
  }

  /**
   * Retry a failed or retry-waiting account now (Console relogin / start). Returns false when the
   * account is not in a failed start state, is disabled or the Adapter is closed.
   */
  retryStart(instanceId: string): boolean {
    const child = this.#children.get(instanceId);
    if (this.#closed || !child || !child.desired.desiredEnabled || !child.start?.phase) return false;
    if (child.supervising && child.retry) { child.retry.abort(); return true; }
    if (child.supervising) return false;
    void this.#supervise(child);
    return true;
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
  /** @internal Reject a self-wait before any Adapter or Index lifecycle state changes. */
  assertExternalLifecycle(operation: 'close' | 'stop'): void {
    const epochs = new Set(this.#retiredEpochs);
    for (const child of this.#children.values()) if (child.current) epochs.add(child.current);
    for (const epoch of epochs) {
      if (epoch.endpoint) endpointRuntimeOf(epoch.endpoint).assertExternalLifecycle(operation);
    }
  }
  async close(): Promise<void> {
    this.assertExternalLifecycle('close');
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
    this.assertExternalLifecycle('stop');
    this.#closed = true;
    this.#verificationAbort.abort(new AdapterManagementError('closed', 'Adapter disposed'));
    this.#lifetime.abort(new AdapterManagementError('closed', 'Adapter disposed'));
    // A disposed Adapter retries nothing: its accounts read as offline, not retrying.
    for (const child of this.#children.values()) { this.#cancelSupervision(child); child.start = undefined; }
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

  /**
   * ADR 0058: login control hooks (relogin / refresh challenge) are needed while the Endpoint's
   * start is still in progress — it is blocked on the very challenge the person wants to refresh.
   * A lease is granted once the current incarnation's start was attempted (starting or started);
   * a stopped / stopping / retired incarnation, a disposed Adapter and a replaced generation
   * (`expectedClient` source check) are refused as for {@link acquire}.
   */
  acquireLogin(canonicalId: CapabilityId, signal?: AbortSignal, expectedClient?: unknown): EndpointChildLease<E> {
    const captured = this.#capture(canonicalId);
    if (!captured.epoch.started && !captured.epoch.startAttempted) {
      throw new EndpointDeliveryError('endpoint_inactive', 'Adapter Endpoint has not started', 'not_sent');
    }
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
    const assertOutbound = () => {
      assertActive();
      if (!epoch.started) throw new EndpointDeliveryError('endpoint_inactive', 'Adapter Endpoint is not ready to send', 'not_sent');
      if (!this.descriptor.capabilities.includes('outbound')) {
        throw new EndpointDeliveryError('outbound_unsupported', 'Endpoint does not support outbound', 'not_sent');
      }
    };
    const streaming = runtime.streaming;
    const scopedStreaming: EndpointStreaming | undefined = streaming && {
      mode: streaming.mode,
      minIntervalMs: streaming.minIntervalMs,
      ...(streaming.supports ? { supports: (request: Pick<EndpointStreamRequest, 'conversation' | 'source'>) => {
        assertOutbound();
        if (request.conversation.endpoint.id !== canonicalId || request.conversation.endpoint.adapter !== this.descriptor.name) {
          throw new EndpointDeliveryError('endpoint_identity_mismatch', 'Stream belongs to another account', 'not_sent');
        }
        return streaming.supports!(request);
      } } : {}),
      open: (request: EndpointStreamRequest): EndpointMessageStream | undefined => {
        assertOutbound();
        if (request.conversation.endpoint.id !== canonicalId || request.conversation.endpoint.adapter !== this.descriptor.name) {
          throw new EndpointDeliveryError('endpoint_identity_mismatch', 'Stream belongs to another account', 'not_sent');
        }
        const streamSignal = request.signal
          ? AbortSignal.any([cancellation.signal, request.signal]) : cancellation.signal;
        const stream = streaming.open({ ...request, signal: streamSignal });
        if (!stream) return undefined;
        return Object.freeze({
          get lastAcknowledgement() { return stream.lastAcknowledgement; },
          write: async (text: string) => { assertOutbound(); streamSignal.throwIfAborted(); return stream.write(text); },
          finish: async (text: string) => { assertOutbound(); streamSignal.throwIfAborted(); return stream.finish(text); },
          cancel: () => stream.cancel(),
        });
      },
    };
    return Object.freeze({
      instanceId: child.desired.instanceId, canonicalId, epoch: epoch.epoch, incarnationId: epoch.incarnationId,
      signal: cancellation.signal, endpoint, assertActive,
      ...(scopedStreaming ? { streaming: Object.freeze(scopedStreaming) } : {}),
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
    return { ...endpointCreationConfiguration(structuredClone(defaults), explicit), id: endpointId };
  }
  #newConfiguration(endpointId: string, explicit: Readonly<Record<string, unknown>>, instanceId: string): Readonly<Record<string, unknown>> {
    const config = this.#creationConfiguration(endpointId, explicit);
    configuredSelfProfile(config);
    return this.prepareConfiguration(structuredClone(config) as Config, {
      instanceId, endpointId, canonicalId: `${this.descriptor.id}~${instanceId}` as CapabilityId,
    }) as Readonly<Record<string, unknown>>;
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
      const child: Child<E> = existing ?? { desired, epoch: 0, supervision: 0 };
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
  #commit(change: PreparedAdapterChange<E>, options?: AdapterMutationOptions): Promise<AdapterMutationResult> {
    const { expectedRevision, next, execution } = change;
    const { run: apply, ...request } = execution;
    this.#assertOpen();
    if (this.#uncertain) throw unknownCommit();
    const repository = this.#options.repository;
    if (!repository || !this.#repositoryReady) throw new AdapterManagementError('unavailable', 'Endpoint desired repository is unavailable or not activated');
    if (this.#mutation || this.#revision !== expectedRevision) {
      throw new AdapterManagementError('conflict', 'Endpoint desired state revision conflicts');
    }
    if (options?.waitForExecution !== false && request.action !== 'start' && request.child?.current?.endpoint && apply) {
      endpointRuntimeOf(request.child.current.endpoint).assertExternalLifecycle('stop');
    }
    const endpoints = next().map(freezeRecord);
    assertSnapshot({ revision: expectedRevision ?? 0, endpoints });
    const commitId = randomUUID();
    const commit = Promise.resolve().then(async () => {
      this.#assertOpen();
      options?.signal?.throwIfAborted();
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
    const completion = this.#executionScope.runInAsyncScope(() => Promise.resolve().then(async () => {
      try {
        if (this.#closed) { execution.status = 'failed'; execution.code = 'adapter_closed'; }
        else { await apply?.(); execution.status = 'applied'; }
      } catch (error) {
        execution.status = 'failed';
        execution.code = error instanceof EndpointStartAttemptError ? 'endpoint_start_failed' : 'endpoint_execution_failed';
      }
      return this.#mutationResult(execution);
    }));
    this.#operations.add(completion);
    void completion.finally(() => this.#operations.delete(completion)).catch(() => undefined);
    return { execution, completion };
  }

  async #prepare(child: Child<E>, signal?: AbortSignal): Promise<ChildEpoch<E>> {
    if (child.current && !child.current.retired) {
      await child.current.preparation;
      return child.current;
    }
    const desired = child.desired;
    const cancellation = new AbortController();
    const epoch: ChildEpoch<E> = { identity: metadata(desired), incarnationId: randomUUID(), epoch: ++child.epoch, cancellation, operations: [], started: false,
      open: false, retired: false, startAttempted: false, leases: 0 };
    child.current = epoch;
    const abort = () => cancellation.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const preparation = Promise.resolve().then(async () => {
      cancellation.signal.throwIfAborted();
      const config: Record<string, unknown> = structuredClone(desired.config);
      const resolved: string[] = [];
      for (const [field, reference] of Object.entries(desired.secretRefs ?? {})) {
        if (!this.#options.secrets) throw new AdapterManagementError('unavailable', 'Endpoint secret resolver is unavailable');
        const value = await this.#options.secrets.resolve(reference, { instanceId: desired.instanceId, signal: cancellation.signal });
        resolved.push(value);
        writeConfigurationPath(config, field, value);
      }
      epoch.secrets = resolved;
      const endpoint = await this.createEndpoint(config as Config, {
        signal: cancellation.signal, epoch: epoch.epoch, incarnationId: epoch.incarnationId, instanceId: desired.instanceId,
        canonicalId: desired.canonicalId, endpointId: desired.endpointId,
      });
      if (!isEndpoint(endpoint)) throw new TypeError('Adapter factory result must implement Endpoint');
      epoch.endpoint = endpoint;
      epoch.operations = this.#options.bind(endpoint, desired, cancellation.signal);
      if (epoch.retired || cancellation.signal.aborted || this.#closed) {
        cancellation.signal.throwIfAborted();
        throw new AdapterManagementError('closed', 'Endpoint creation retired');
      }
    });
    epoch.preparation = preparation;
    try { await preparation; return epoch; }
    catch (error) {
      if (error instanceof Error) preparationErrors.add(error);
      await this.#stopEpoch(epoch);
      throw error;
    }
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
    this.#cancelSupervision(child);
    child.start = undefined;
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
    if (epoch.endpoint) retireEndpoint(epoch.endpoint);
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
      stopped: current?.retired ?? false, startAttempted: current?.startAttempted ?? false, ...startFacts(child) });
  }

  #cancelSupervision(child: Child<E>): void {
    child.supervision += 1;
    child.supervising = false;
    child.retry?.abort();
    child.retry = undefined;
  }
  #supervised(child: Child<E>, token: number): boolean {
    return !this.#closed && child.supervision === token && this.#children.get(child.desired.instanceId) === child
      && child.desired.desiredEnabled;
  }

  /**
   * One background start loop per account. The returned promise settles with the first attempt
   * (rejecting with {@link EndpointStartAttemptError}); later attempts only update the start state.
   * A loop exits silently when stop/replace/update/remove/dispose supersedes it, and never opens
   * an account it no longer owns: each attempt is a fresh epoch checked against the token.
   */
  #supervise(child: Child<E>, options: Readonly<{ restart?: boolean }> = {}): Promise<void> {
    if (this.#closed) return Promise.reject(new AdapterManagementError('closed', 'Adapter is closed'));
    if (child.current?.started && !child.current.retired) return Promise.resolve();
    if (!options.restart && child.supervising && !child.start?.phase) {
      // An attempt is already running (e.g. activation after a mutation started it).
      return Promise.resolve();
    }
    this.#cancelSupervision(child);
    const token = child.supervision;
    let settle!: (error?: unknown) => void;
    const first = new Promise<void>((resolve, reject) => {
      let settled = false;
      settle = error => {
        if (settled) return;
        settled = true;
        if (error === undefined) resolve(); else reject(error);
      };
    });
    void first.catch(() => undefined);
    child.supervising = true;
    // The first attempt begins synchronously, exactly where a direct start would have begun.
    const loop = this.#executionScope.runInAsyncScope(async () => {
      let attempt = 0;
      try {
        for (;;) {
          if (!this.#supervised(child, token)) {
            settle(new AdapterManagementError('inactive', 'Endpoint start was superseded'));
            return;
          }
          attempt += 1;
          child.start = { attempt, ...(child.start?.failure ? { failure: child.start.failure } : {}),
            ...(child.start?.reason ? { reason: child.start.reason } : {}) };
          try {
            // Dispose retires the attempt's epoch itself (reason `inactive`), as for any stop.
            await this.#start(child);
          } catch (error) {
            if (!this.#supervised(child, token)) { settle(error); return; }
            const terminal = this.#terminalStartFailure(child, error);
            const code = terminal === 'cleanup' ? 'endpoint_cleanup_failed' : startErrorCode(error);
            const delay = terminal ? undefined : retryDelay(attempt);
            const at = Date.now();
            const category = failureCategory(error, terminal);
            // Stored / returned text is built from the category and code only (raw SDK text may carry
            // credentials); the warn log gets the raw message with this account's credentials masked.
            const reason = redactFailureMessage(error, [...credentialValues(child.desired.config),
              ...credentialFieldValues(child.desired.config, this.configurationCredentialFields), ...(child.current?.secrets ?? [])]);
            child.start = { attempt, failure: Object.freeze({ code, at, category, message: failureSummary(category, code) }),
              ...(reason ? { reason } : {}),
              phase: terminal ? 'failed' : 'retrying', ...(delay !== undefined ? { nextRetryAt: at + delay } : {}) };
            logger.warn(formatCompact({ op: 'endpoint_start_failed', adapter: this.descriptor.name,
              endpoint: child.desired.endpointId, attempt, error: errorName(error), code, category,
              ...(reason ? { reason } : {}),
              ...(delay !== undefined ? { retryInMs: delay } : { retry: 'manual' }) }));
            settle(new EndpointStartAttemptError(code, { cause: error }));
            if (delay === undefined) return;
            await this.#retryWait(child, delay);
            continue;
          }
          if (!this.#supervised(child, token) || !child.current?.started || child.current.retired) {
            // Stopped before or while starting without an error: an intentional stop, not a failure.
            settle();
            return;
          }
          child.start = undefined;
          settle();
          return;
        }
      } finally {
        if (child.supervision === token) { child.supervising = false; child.retry = undefined; }
      }
    });
    this.#operations.add(loop);
    void loop.finally(() => this.#operations.delete(loop)).catch(() => undefined);
    void loop.catch(error => settle(error));
    return first;
  }
  /** Configuration, unsupported and cleanup failures (and every interactive login) wait for a person. */
  #terminalStartFailure(child: Child<E>, error: unknown): false | 'configuration' | 'cleanup' | 'interactive' {
    if (child.current?.cleanupFailed) return 'cleanup';
    if (error instanceof AdapterManagementError && (error.code === 'invalid_configuration' || error.code === 'unsupported')) {
      return 'configuration';
    }
    // A TypeError while creating the Endpoint is a configuration mistake — unless it is a transport
    // failure surfaced as TypeError (undici `fetch failed`, with a network `cause`): that retries.
    if (error instanceof Error && preparationErrors.has(error) && error instanceof TypeError && !isNetworkTypeError(error)) return 'configuration';
    if (this.#descriptor?.login?.mode === 'interactive') return 'interactive';
    return false;
  }
  #retryWait(child: Child<E>, delay: number): Promise<void> {
    const wake = new AbortController();
    child.retry = wake;
    const lifetime = this.#lifetime.signal;
    return new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer);
        wake.signal.removeEventListener('abort', done);
        lifetime.removeEventListener('abort', done);
        if (child.retry === wake) child.retry = undefined;
        resolve();
      };
      const timer = setTimeout(done, delay);
      timer.unref?.();
      wake.signal.addEventListener('abort', done, { once: true });
      lifetime.addEventListener('abort', done, { once: true });
      if (wake.signal.aborted || lifetime.aborted) done();
    });
  }
}

/** The first start attempt of a supervision failed; the loop goes on per its retry policy. */
class EndpointStartAttemptError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) {
    super('Endpoint start failed', options);
    this.name = 'EndpointStartAttemptError';
  }
}
/** Errors raised while creating/binding an Endpoint (configuration, not transport). */
const preparationErrors = new WeakSet<Error>();

const NETWORK_ERROR_CODE = /^(?:ECONN\w*|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|ENETDOWN|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|EPROTO|CERT_\w+|ERR_TLS\w*|UND_ERR\w*|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_\w+|SELF_SIGNED_CERT\w*)$/u;

/**
 * A transport failure thrown as `TypeError`: undici's `fetch failed` (its `cause` carries the
 * socket / DNS / TLS code), or any TypeError whose cause chain has a network error code.
 */
function isNetworkTypeError(error: TypeError): boolean {
  if (/^fetch failed$|network ?error|failed to fetch/iu.test(error.message)) return true;
  for (let current: unknown = error.cause, depth = 0; current && typeof current === 'object' && depth < 4;
    current = (current as { cause?: unknown }).cause, depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_ERROR_CODE.test(code)) return true;
  }
  return false;
}

function startFacts<E extends AnyEndpoint>(child: Child<E>): Pick<EndpointMetadata, 'startAttempt' | 'startFailure' | 'startPhase' | 'nextRetryAt'> {
  const state = child.start;
  return {
    startAttempt: state?.attempt ?? 0,
    ...(state?.failure ? { startFailure: state.failure } : {}),
    ...(state?.phase ? { startPhase: state.phase } : {}),
    ...(state?.nextRetryAt !== undefined ? { nextRetryAt: state.nextRetryAt } : {}),
  };
}
function retryDelay(attempt: number): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (1 - RETRY_JITTER + Math.random() * 2 * RETRY_JITTER));
}
/** Stable, credential-free code: an error's own short code, else its class name. */
function startErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && /^[\w.:-]{1,64}$/u.test(code)) return code;
  return errorName(error);
}
const FAILURE_MESSAGE_MAX = 200;
/** Classified start failure cause; credential-free (reads only codes, names and message words). */
function failureCategory(error: unknown, terminal: false | 'configuration' | 'cleanup' | 'interactive'): EndpointFailureCategory {
  if (terminal === 'configuration') return 'config';
  const parts: string[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth += 1) {
    if (typeof current !== 'object') { parts.push(String(current)); break; }
    const value = current as { code?: unknown; name?: unknown; message?: unknown; status?: unknown };
    parts.push(...[value.code, value.name, value.message, value.status].filter(item => item !== undefined).map(String));
  }
  const text = parts.join(' ');
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|authenticat|invalid[ _-]?(?:token|secret|credential|password|signature|appid|app[ _-]?id|key)|access denied|login failed/iu.test(text)) return 'auth';
  if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline/iu.test(text)) return 'timeout';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|network|fetch failed|getaddrinfo|certificate|TLS/iu.test(text)) return 'network';
  if (/exit(?:ed)? (?:with )?code|exit code|spawn|SIGTERM|SIGKILL|child process/iu.test(text)) return 'process_exit';
  if (error instanceof AdapterManagementError && (error.code === 'invalid_configuration' || error.code === 'unsupported')) return 'config';
  if (/invalid[ _-]?config|missing required|is required|must be (?:a|an|set)/iu.test(text)) return 'config';
  return 'unknown';
}
const FAILURE_SUMMARIES: Readonly<Record<EndpointFailureCategory, string>> = Object.freeze({
  auth: 'The platform rejected the account credentials',
  network: 'The platform could not be reached',
  timeout: 'The connection attempt timed out',
  config: 'The account configuration is incomplete or invalid',
  process_exit: 'The account process exited during start-up',
  unknown: 'The account failed to start',
});
/** Credential-free operator text: category description plus the error code. */
function failureSummary(category: EndpointFailureCategory, code: string): string {
  return `${FAILURE_SUMMARIES[category]} (${code})`.slice(0, FAILURE_MESSAGE_MAX);
}
/** String leaves of an account configuration under credential-like keys. */
function credentialValues(config: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 8) return;
    if (typeof value === 'string') {
      if (/(?:password|passwd|secret|apikey|accesskey|privatekey|credential|authorization|cookie|token)/u
        .test(key.replace(/[^a-z0-9]/giu, '').toLowerCase())) out.push(value);
      return;
    }
    if (value && typeof value === 'object') for (const [child, item] of Object.entries(value)) visit(item, child, depth + 1);
  };
  visit(config, '', 0);
  return out;
}
/** String values at the Adapter's declared credential paths. */
function credentialFieldValues(config: Readonly<Record<string, unknown>>, fields: readonly string[]): string[] {
  return fields.map(field => readConfigurationPath(config, field)).filter((value): value is string => typeof value === 'string' && value.length > 0);
}
/**
 * Short operator text from a start error: URL credentials, query strings, the account's credential
 * values and long token-like runs are masked; at most 200 characters.
 */
function redactFailureMessage(error: unknown, secrets: readonly string[] = []): string | undefined {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!raw) return undefined;
  let text = raw;
  for (const secret of [...new Set(secrets)].filter(value => typeof value === 'string' && value.length >= 4)
    .sort((a, b) => b.length - a.length)) text = text.split(secret).join('***');
  text = text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/giu, '$1***@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#][^\s]*/giu, '$1?***')
    .replace(/\b(bearer|basic|token|key|secret|password|pwd|cookie)(\s*[:=]\s*)[^\s,;]+/giu, '$1$2***')
    .replace(/[A-Za-z0-9_\-+/=]{24,}/gu, '***')
    // Words that name or carry a credential (`secret-token`, `api_key=…`) are masked whole.
    .replace(/[^\s:,;()"'`]*(?:secret|token|passw|cookie|credential|api[_-]?key|private[_-]?key)[^\s:,;()"'`]*/giu, '***')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > FAILURE_MESSAGE_MAX ? `${text.slice(0, FAILURE_MESSAGE_MAX - 1)}…` : text;
}
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[\w.:-]{1,64}$/u.test(name) ? name : 'Error';
}
/** One listener per account attempt; many accounts must not trip the EventTarget leak warning. */
function unboundedAbortController(): AbortController {
  const controller = new AbortController();
  setMaxListeners(0, controller.signal);
  return controller;
}
/** Resolves when `work` settles, the grace period ends or `signal` aborts — never rejects. */
function graceWait(work: Promise<unknown>, ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = Number.isFinite(ms) ? setTimeout(done, Math.max(0, ms)) : undefined;
    signal.addEventListener('abort', done, { once: true });
    void work.then(done, done);
  });
}

function metadata(record: EndpointDesiredRecord): import('./adapter-types.js').EndpointDesiredMetadata {
  const { config: _config, secretRefs: _secretRefs, platformUserId: _platformUserId, ...view } = record;
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
  if (endpoint !== expectedClient) {
    throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint source incarnation is retired', 'not_sent');
  }
}

function samePersistedRecords(left: readonly EndpointDesiredRecord[], right: readonly EndpointDesiredRecord[]): boolean {
  // Compare the complete persisted document; JSON storage omits optional undefined fields.
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
}
