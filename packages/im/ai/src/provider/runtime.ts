import type { AssistantStreamEvent } from '../llm/llm-api-runtime.js';
import type { DecisionQuestions } from '../decision/types.js';
import type { CredentialPort, ProviderDefinition, ProviderDriverResolver, ProviderDriverLease, ProviderExecution, ProviderExecutionTraits } from './driver.js';
import type { ProviderRepository } from './repository.js';
import { normalizeProviderGraph, createEmptyProviderGraph } from './graph.js';
import { createProfileReference, profileView, resolveProviderProfile } from './selection.js';
import { providerStateScope, projectProviderState, stampProviderState } from './state.js';
import { providerPlanFingerprint } from './plan.js';
import { assertProviderLanguageRequirements } from './requirements.js';
import { OwnedLanguageRun } from './owned-stream.js';
import { createProviderCleanupReporter, type ProviderCleanupObserver } from './cleanup.js';
import { ProviderBindingResourceOwner } from './resources.js';
import {
  ProviderError, type ExecutionBinding, type ProviderCallContext, type ProviderGraph,
  type InferenceClient, type GenerateInput, type GenerateImageInput, type EvaluateDecisionInput,
  type ModelKind, type ProfileQuery, type ProfileView, type InferencePurpose, type ProfileRef,
} from './types.js';

export interface ProviderBindingContext { readonly binding: ExecutionBinding; readonly context: ProviderCallContext }
export interface ProviderExecutionContext extends ProviderBindingContext {
  readonly driver: ProviderDefinition<unknown, unknown>;
  /** A background shared refresh retains the exact driver, independently of its waiter. */
  readonly retainDriver: () => ProviderDriverLease;
}
export interface InferenceRuntimeOptions {
  readonly repository: Pick<ProviderRepository, 'readGraph'>;
  /** Resolver is tied to the operation's held plugin snapshot, never a latest registry. */
  readonly drivers: ProviderDriverResolver;
  readonly credentials: (input: ProviderExecutionContext) => CredentialPort | Promise<CredentialPort>;
  readonly fetch: (input: ProviderExecutionContext) => typeof globalThis.fetch;
  /** An error is an error, not permission. Absence preserves the established owner/Host baseline. */
  readonly canUseProfile?: (input: ProviderBindingContext & Readonly<{ purpose?: InferencePurpose }>) => boolean | Promise<boolean>;
  readonly onCleanupError?: ProviderCleanupObserver;
  /** Host-owned pure cache data may outlive one operation-bound resolver/runtime. */
  readonly resources?: ProviderBindingResourceOwner;
  /** Exact held generation identity, used only for internal operation graph captures. */
  readonly generationIdentity?: object;
}
export interface OpenInferenceOperationInput { readonly context: ProviderCallContext; readonly signal?: AbortSignal }
declare const capturedGraph: unique symbol;
/** Host-private, non-serializable capture. Public InferenceClient never accepts one. */
export interface InferenceGraphSnapshot { readonly [capturedGraph]: true }
class CapturedInferenceGraph implements InferenceGraphSnapshot {
  declare readonly [capturedGraph]: true;
  readonly #graph: ProviderGraph;
  readonly #context: ProviderCallContext;
  readonly #generation: object;
  constructor(graph: ProviderGraph, context: ProviderCallContext, generation: object) {
    this.#graph = graph; this.#context = context; this.#generation = generation; Object.freeze(this);
  }
  delegate(input: ProviderCallContext, generation: object): ProviderGraph {
    if (generation !== this.#generation || input.rootId !== this.#context.rootId
      || input.ownerId !== this.#context.ownerId || input.hostOwnerId !== this.#context.hostOwnerId) throw new ProviderError('forbidden');
    return this.#graph;
  }
  read(input: ProviderCallContext, generation: object): ProviderGraph {
    if (generation !== this.#generation || input.rootId !== this.#context.rootId
      || input.operationId !== this.#context.operationId || input.sessionKey !== this.#context.sessionKey) throw new ProviderError('forbidden');
    return this.#graph;
  }
}
export interface OpenInferenceScopeInput extends OpenInferenceOperationInput { readonly snapshot?: InferenceGraphSnapshot }
export interface ProviderInvocationInput extends OpenInferenceOperationInput {
  readonly purpose: InferencePurpose;
  readonly profile?: ProfileRef;
}
export interface BoundInferenceExecution {
  readonly binding: ExecutionBinding;
  readonly client: InferenceClient;
}
/** Internal operation view for Agent/Host integration; never a public plugin directory. */
export interface InferenceOperationScope {
  readonly signal: AbortSignal;
  readonly graph: ProviderGraph;
  readonly snapshot: InferenceGraphSnapshot;
  readonly context: ProviderCallContext;
  readonly client: InferenceClient;
  resolve<K extends ModelKind>(input: Readonly<{ kind: K; purpose?: InferencePurpose; profile?: ProfileRef<K> }>): Promise<ExecutionBinding>;
  describeModel(input: Readonly<{ purpose?: InferencePurpose; profile?: ProfileRef<'language'> }>): Promise<ProviderExecutionTraits>;
  close(): Promise<void>;
}
interface InferenceOperationOptions {
  readonly runtime: InferenceRuntimeOptions;
  readonly graph: ProviderGraph;
  readonly operation: OpenInferenceOperationInput;
  readonly cleanup: ReturnType<typeof createProviderCleanupReporter>;
  readonly resources: ProviderBindingResourceOwner;
  readonly fixed?: Readonly<{ binding: ExecutionBinding; purpose: InferencePurpose }>;
}
interface CreatedProviderExecution {
  readonly execution: ProviderExecution;
  release(): Promise<void>;
}
function retainedDriver(original: ProviderDriverLease): ProviderDriverLease & { retain(): ProviderDriverLease } {
  let count = 1;
  let disposed: Promise<void> | undefined;
  function lease(): ProviderDriverLease {
    let released: Promise<void> | undefined;
    return Object.freeze({ reference: original.reference, definition: original.definition,
      release: () => released ??= (async () => {
        count--;
        if (count === 0) await (disposed ??= Promise.resolve().then(() => original.release()));
      })() });
  }
  const primary = lease();
  return Object.freeze({ ...primary, retain: () => {
    if (count === 0) throw new ProviderError('operation-closed');
    count++;
    return lease();
  } });
}
function contextSnapshot(input: ProviderCallContext): ProviderCallContext {
  for (const id of [input.rootId, input.ownerId, input.hostOwnerId, input.operationId]) {
    if (typeof id !== 'string' || !id || id !== id.trim()) throw new ProviderError('forbidden');
  }
  return Object.freeze({ ...input, ...(input.sessionChat ? { sessionChat: Object.freeze({ ...input.sessionChat }) } : {}) });
}
function kindOf(purpose: InferencePurpose): ModelKind {
  return purpose === 'image' ? 'image' : purpose.startsWith('decision:') ? 'decision' : 'language';
}

/** One operation owns its graph snapshot, runs and leases. No ambient current account/session. */
class InferenceOperation implements InferenceClient {
  readonly #controller = new AbortController();
  readonly #runs = new Set<OwnedLanguageRun>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #resources = new Map<unknown, ReturnType<ProviderBindingResourceOwner['acquire']>>();
  readonly #context: ProviderCallContext;
  readonly #options: InferenceRuntimeOptions;
  readonly #graph: ProviderGraph;
  readonly #cleanup: ReturnType<typeof createProviderCleanupReporter>;
  readonly #resourceOwner: ProviderBindingResourceOwner;
  readonly #fixed?: Readonly<{ binding: ExecutionBinding; purpose: InferencePurpose }>;
  #closed = false;
  #closing?: Promise<void>;
  readonly #cancel = () => { void this.close().catch(() => undefined); };
  constructor(options: InferenceOperationOptions) {
    this.#options = options.runtime;
    this.#graph = options.graph;
    this.#cleanup = options.cleanup;
    this.#resourceOwner = options.resources;
    this.#fixed = options.fixed;
    const input = options.operation;
    this.#context = contextSnapshot(input.context);
    this.signal = input.signal ? AbortSignal.any([input.signal, this.#controller.signal]) : this.#controller.signal;
    this.signal.addEventListener('abort', this.#cancel, { once: true });
  }
  readonly signal: AbortSignal;
  scope(): InferenceOperationScope {
    return Object.freeze({ graph: this.#graph,
      snapshot: new CapturedInferenceGraph(this.#graph, this.#context, this.#options.generationIdentity ?? this.#options.drivers),
      context: this.#context, client: this, signal: this.signal,
      resolve: async <K extends ModelKind>(input: Readonly<{ kind: K; purpose?: InferencePurpose; profile?: ProfileRef<K> }>) => {
        const binding = this.#binding(input.kind, input.profile, input.purpose);
        await this.#authorize(binding, input.purpose);
        return binding;
      },
      describeModel: async (input: Parameters<InferenceOperationScope['describeModel']>[0]) => {
        const binding = this.#binding('language', input.profile, input.purpose);
        await this.#authorize(binding, input.purpose);
        const lease = await this.#options.drivers.acquire({ service: binding.service, signal: this.signal });
        try {
          const bound = this.#validateDriverBinding(lease, binding);
          return Object.freeze({ ...lease.definition.describeModel?.(bound) });
        } finally { await this.#dispose(undefined, lease); }
      }, close: () => this.close() });
  }
  async #dispose(execution: ProviderExecution | undefined, lease: ProviderDriverLease | undefined): Promise<void> {
    try { await execution?.dispose?.(); }
    catch (error) { this.#cleanup.report({ operationId: this.#context.operationId, phase: 'driver-dispose', error }); }
    try { await lease?.release(); }
    catch (error) { this.#cleanup.report({ operationId: this.#context.operationId, phase: 'driver-release', error }); }
  }
  #assertOpen(): void {
    if (this.#closed) throw new ProviderError('operation-closed');
    this.signal.throwIfAborted();
  }
  async #authorize(binding: ExecutionBinding, purpose?: InferencePurpose): Promise<void> {
    this.#assertOpen();
    if (this.#options.canUseProfile && await this.#options.canUseProfile({ binding, context: this.#context, purpose }) !== true) {
      throw new ProviderError('forbidden');
    }
    this.#assertOpen();
  }
  #binding<K extends ModelKind>(kind: K, profile: ProfileRef<K> | undefined, purpose?: InferencePurpose): ExecutionBinding {
    if (this.#fixed && (!purpose || purpose === this.#fixed.purpose)) {
      if (profile && profile.id !== this.#fixed.binding.profile.id) throw new ProviderError('stale-reference');
      const reference = createProfileReference({ binding: this.#fixed.binding, kind });
      return resolveProviderProfile({ graph: this.#graph, context: this.#context, kind, profile: profile ?? reference, purpose });
    }
    return resolveProviderProfile({ graph: this.#graph, context: this.#context, kind, profile, purpose });
  }
  #track<T>(task: Promise<T>): Promise<T> {
    this.#pending.add(task);
    void task.then(() => this.#pending.delete(task), () => this.#pending.delete(task));
    return task;
  }
  #validateDriverBinding(lease: ProviderDriverLease, binding: ExecutionBinding): ExecutionBinding<unknown, unknown> {
    const reference = lease.reference;
    if (reference.id !== binding.service.driver.id || reference.owner !== binding.service.driver.owner
      || reference.contractVersion !== binding.service.driver.contractVersion
      || lease.definition.id !== reference.id || lease.definition.contractVersion !== reference.contractVersion) {
      throw new ProviderError('driver-contract-mismatch');
    }
    if (!lease.definition.authentication.methods.includes(binding.account.authentication.method)) throw new ProviderError('unsupported-capability');
    const service = Object.freeze({ ...binding.service, options: lease.definition.serviceSchema.parse(binding.service.options) });
    const models = lease.definition.models(service);
    if (!models[binding.model.id] || providerPlanFingerprint(models[binding.model.id]) !== providerPlanFingerprint(binding.model)) {
      throw new ProviderError('driver-contract-mismatch');
    }
    const schema = lease.definition.profileSchema?.({ service, model: binding.model });
    const profile = Object.freeze({ ...binding.profile, parameters: schema ? schema.parse(binding.profile.parameters) : binding.profile.parameters });
    return Object.freeze({ ...binding, service, profile });
  }
  async #create(binding: ExecutionBinding, signal: AbortSignal): Promise<CreatedProviderExecution> {
    let lease: ProviderDriverLease | undefined;
    let execution: ProviderExecution | undefined;
    try {
      const retainedOwner = retainedDriver(await this.#options.drivers.acquire({ service: binding.service, signal }));
      lease = retainedOwner;
      signal.throwIfAborted();
      const bound = this.#validateDriverBinding(lease, binding);
      const executionContext = Object.freeze({ binding, context: this.#context, driver: lease.definition, retainDriver: () => retainedOwner.retain() });
      const credentials = await this.#options.credentials(executionContext);
      signal.throwIfAborted();
      // Each operation retains its namespace between tool rounds. Idle state owns no Driver lease.
      const resourceLease = this.#resourceOwner.acquire({ binding, driver: lease.definition });
      const previousResource = this.#resources.get(resourceLease.key);
      if (previousResource) resourceLease.release();
      else this.#resources.set(resourceLease.key, resourceLease);
      execution = await lease.definition.createExecution({ binding: bound, credentials, context: this.#context,
        resources: (previousResource ?? resourceLease).resources, fetch: this.#options.fetch(executionContext), signal });
      signal.throwIfAborted();
      let release: Promise<void> | undefined;
      const created = execution, retained = lease;
      return { execution, release: () => release ??= this.#dispose(created, retained) };
    } catch (error) {
      await this.#dispose(execution, lease);
      throw error;
    }
  }
  async list<K extends ModelKind>(input: ProfileQuery<K>): Promise<readonly ProfileView<K>[]> {
    this.#assertOpen();
    const result: ProfileView<K>[] = [];
    for (const profile of Object.values(this.#graph.profiles)) {
      const account = this.#graph.accounts[profile.accountId];
      const service = this.#graph.services[account.serviceId];
      if (!service.models[profile.model].kinds.includes(input.kind)) continue;
      const binding = Object.freeze({ graphRevision: this.#graph.revision, profile, account, service, model: service.models[profile.model] });
      const ref = createProfileReference({ binding, kind: input.kind });
      try { resolveProviderProfile({ graph: this.#graph, context: this.#context, kind: input.kind, profile: ref }); }
      catch (error) { if (error instanceof ProviderError && error.code === 'forbidden') continue; throw error; }
      if (this.#options.canUseProfile && await this.#options.canUseProfile({ binding, context: this.#context }) !== true) continue;
      result.push(profileView({ binding, kind: input.kind }));
    }
    this.#assertOpen();
    return Object.freeze(result);
  }
  generate(input: GenerateInput) {
    return this.#track(this.#generate(input));
  }
  async #generate(input: GenerateInput) {
    const purpose = input.purpose ?? 'chat';
    const binding = this.#binding('language', input.profile, purpose);
    assertProviderLanguageRequirements({ binding, request: input.request });
    await this.#authorize(binding, purpose);
    const signal = input.signal ? AbortSignal.any([this.signal, input.signal]) : this.signal;
    signal.throwIfAborted();
    const resource = await this.#create(binding, signal);
    try {
      if (!resource.execution.language) throw new ProviderError('unsupported-capability');
      const scope = providerStateScope({ binding, context: this.#context });
      const message = await resource.execution.language.generate({ request: { ...input.request,
        context: projectProviderState({ context: input.request.context, scope }) }, signal });
      return stampProviderState({ message, scope });
    } finally { await resource.release(); }
  }
  stream(input: GenerateInput) { return this.#track(this.#stream(input)); }
  async #stream(input: GenerateInput): Promise<OwnedLanguageRun> {
    const purpose = input.purpose ?? 'chat';
    const binding = this.#binding('language', input.profile, purpose);
    assertProviderLanguageRequirements({ binding, request: input.request });
    await this.#authorize(binding, purpose);
    assertProviderLanguageRequirements({ binding, request: input.request, streaming: true });
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal, ...(input.signal ? [input.signal] : [])]);
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    let resource: CreatedProviderExecution | undefined;
    try {
      signal.throwIfAborted();
      resource = await this.#create(binding, signal);
      if (!resource.execution.language) throw new ProviderError('unsupported-capability');
      const scope = providerStateScope({ binding, context: this.#context });
      const source = await resource.execution.language.stream({ request: { ...input.request,
        context: projectProviderState({ context: input.request.context, scope }) }, signal });
      signal.throwIfAborted();
      const retained = resource;
      const run = new OwnedLanguageRun({ source, controller, project: (event: AssistantStreamEvent) =>
        event.message ? { ...event, message: stampProviderState({ message: event.message, scope }) } : event,
      onCleanupError: error => this.#cleanup.report({ operationId: this.#context.operationId, phase: 'iterator-return', error }),
      release: async () => {
        signal.removeEventListener('abort', cancel);
        this.#runs.delete(run);
        await retained.release();
      } });
      this.#runs.add(run);
      return run;
    } catch (error) {
      signal.removeEventListener('abort', cancel);
      controller.abort(error);
      await resource?.release();
      throw error;
    }
  }
  evaluate<const Q extends DecisionQuestions>(input: EvaluateDecisionInput<Q>) {
    return this.#track(this.#evaluate(input));
  }
  async #evaluate<const Q extends DecisionQuestions>(input: EvaluateDecisionInput<Q>) {
    const binding = this.#binding('decision', input.profile);
    await this.#authorize(binding);
    const signal = input.signal ? AbortSignal.any([this.signal, input.signal]) : this.signal;
    signal.throwIfAborted();
    const resource = await this.#create(binding, signal);
    try {
      if (!resource.execution.decision) throw new ProviderError('unsupported-capability');
      const result = await resource.execution.decision.evaluate({ state: input.state, questions: input.questions, timeoutMs: input.timeoutMs, signal });
      return result;
    } finally { await resource.release(); }
  }
  generateImage(input: GenerateImageInput) { return this.#track(this.#generateImage(input)); }
  async #generateImage(input: GenerateImageInput) {
    const binding = this.#binding('image', input.profile, input.profile ? undefined : 'image');
    await this.#authorize(binding, 'image');
    const signal = input.signal ? AbortSignal.any([this.signal, input.signal]) : this.signal;
    signal.throwIfAborted();
    const resource = await this.#create(binding, signal);
    try {
      if (!resource.execution.image) throw new ProviderError('unsupported-capability');
      const result = await resource.execution.image.generate({ request: input.request, signal });
      return result;
    } finally { await resource.release(); }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.signal.removeEventListener('abort', this.#cancel);
    this.#controller.abort(new ProviderError('operation-closed'));
    this.#closing = Promise.resolve().then(async () => {
      await Promise.all([...this.#runs].map(run => run.close()));
      await Promise.allSettled([...this.#pending]);
      for (const resource of this.#resources.values()) resource.release();
      this.#resources.clear();
    });
    return this.#closing;
  }
  [Symbol.asyncDispose](): Promise<void> { return this.close(); }
}

export function createInferenceRuntime(options: InferenceRuntimeOptions) {
  const cleanup = createProviderCleanupReporter(options.onCleanupError);
  const resources = options.resources ?? new ProviderBindingResourceOwner(error => cleanup.report({ operationId: 'provider-runtime', phase: 'binding-state-dispose', error }));
  let retired = false;
  const read = async (input: OpenInferenceOperationInput): Promise<ProviderGraph> => {
    input.signal?.throwIfAborted();
    if (retired) throw new ProviderError('operation-closed');
    const graph = await options.repository.readGraph({ rootId: input.context.rootId });
    input.signal?.throwIfAborted();
    const snapshot = graph === undefined ? createEmptyProviderGraph(input.context.rootId) : normalizeProviderGraph(graph);
    resources.reconcile(snapshot);
    return snapshot;
  };
  return Object.freeze({
    cleanupState: () => cleanup.read(),
    /** Stop new operations without cancelling existing business work. */
    retire: () => { retired = true; if (!options.resources) resources.retire(); },
    async openOperation(input: OpenInferenceOperationInput): Promise<InferenceClient> {
      const graph = await read(input);
      return new InferenceOperation({ runtime: options, graph, operation: input, cleanup, resources });
    },
    async openScope(input: OpenInferenceScopeInput): Promise<InferenceOperationScope> {
      input.signal?.throwIfAborted();
      if (retired) throw new ProviderError('operation-closed');
      if (input.snapshot !== undefined && !(input.snapshot instanceof CapturedInferenceGraph)) throw new ProviderError('forbidden');
      const graph = input.snapshot instanceof CapturedInferenceGraph
        ? input.snapshot.read(input.context, options.generationIdentity ?? options.drivers) : await read(input);
      return new InferenceOperation({ runtime: options, graph, operation: input, cleanup, resources }).scope();
    },
    /** Host-owned child operation; possession never allows changing the original principal. */
    async openDelegatedScope(input: OpenInferenceScopeInput & Readonly<{ snapshot: InferenceGraphSnapshot }>): Promise<InferenceOperationScope> {
      input.signal?.throwIfAborted();
      if (!(input.snapshot instanceof CapturedInferenceGraph)) throw new ProviderError('forbidden');
      const graph = input.snapshot.delegate(input.context, options.generationIdentity ?? options.drivers);
      return new InferenceOperation({ runtime: options, graph, operation: input, cleanup, resources }).scope();
    },
    async withInvocation<R>(input: ProviderInvocationInput, use: (execution: BoundInferenceExecution) => Promise<R>): Promise<R> {
      const graph = await read(input);
      const binding = resolveProviderProfile({ graph, context: input.context, kind: kindOf(input.purpose), profile: input.profile, purpose: input.purpose });
      const client = new InferenceOperation({ runtime: options, graph, operation: input, cleanup, resources, fixed: { binding, purpose: input.purpose } });
      try { return await use(Object.freeze({ binding, client })); }
      finally { await client.close(); }
    },
  });
}
export type InferenceRuntime = ReturnType<typeof createInferenceRuntime>;
