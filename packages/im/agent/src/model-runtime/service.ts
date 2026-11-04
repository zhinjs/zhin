import {
  createProfileReference, providerPurposeProfiles, resolveProviderProfile, ProviderError,
  type ExecutionBinding, type InferenceOperationScope, type LanguagePurpose,
} from '@zhin.js/ai/provider';
import { createInvocationCompletion, invocationModel } from './completion.js';
import { ModelRuntimeError, type ModelExecutionBundle, type ModelExecutionScope,
  type ModelDelegationAuthority, type ModelContextAcquireInput, type ModelRuntimeServiceOptions, type ModelTurnAcquireInput } from './types.js';

async function bundle(input: Readonly<{
  scope: InferenceOperationScope;
  binding: ExecutionBinding;
  purpose: LanguagePurpose | `agent:${string}`;
}>): Promise<ModelExecutionBundle> {
  return Object.freeze({ binding: input.binding, model: invocationModel(input.binding, await input.scope.describeModel({ purpose: input.purpose,
    profile: createProfileReference({ binding: input.binding, kind: 'language' }) })),
    completion: createInvocationCompletion({ binding: input.binding, client: input.scope.client, purpose: input.purpose }) });
}

/** Agent integration only. Host persists configuration and owns authentication; this
 * class borrows the exact operation generation and never creates Provider directories. */
export class ModelRuntimeService {
  #closed = false;
  constructor(private readonly options: ModelRuntimeServiceOptions) {}

  async acquireForTurn(input: ModelTurnAcquireInput): Promise<ModelExecutionScope> {
    if (this.#closed) throw new ModelRuntimeError('not-prepared');
    if (!input.lease.active || !input.snapshots.owns(input.lease)) throw new ModelRuntimeError('invalid-context');
    input.request.signal.throwIfAborted();
    const context = await this.options.context({ request: input.request, binding: input.binding });
    if (context.rootId !== this.options.rootId || context.hostOwnerId !== this.options.hostOwnerId
      || context.operationId !== input.request.identity.turnId || context.sessionKey !== input.request.session.key) {
      throw new ModelRuntimeError('invalid-context');
    }
    return this.acquireForContext({ lease: input.lease, snapshots: input.snapshots, context,
      bindingName: input.binding.name, signal: input.request.signal, inferenceSnapshot: input.inferenceSnapshot });
  }

  acquireForContext(input: ModelContextAcquireInput): Promise<ModelExecutionScope> { return this.#acquire(input, false); }

  async #acquire(input: ModelContextAcquireInput, delegated: boolean): Promise<ModelExecutionScope> {
    if (this.#closed && !delegated) throw new ModelRuntimeError('not-prepared');
    if (!input.lease.active || !input.snapshots.owns(input.lease)
      || input.context.rootId !== this.options.rootId || input.context.hostOwnerId !== this.options.hostOwnerId) {
      throw new ModelRuntimeError('invalid-context');
    }
    input.signal?.throwIfAborted();
    const context = input.context;
    const runtime = this.options.inferenceFactory({ lease: input.lease, snapshots: input.snapshots });
    let scope: InferenceOperationScope;
    try {
      scope = delegated && input.inferenceSnapshot
        ? await runtime.openDelegatedScope({ context, signal: input.signal, snapshot: input.inferenceSnapshot })
        : await runtime.openScope({ context, signal: input.signal, snapshot: input.inferenceSnapshot });
    } catch (error) { runtime.retire(); throw error; }
    try {
      const purpose = !input.bindingName || input.bindingName === 'zhin' ? 'chat' : `agent:${input.bindingName}` as const;
      const selected = await scope.resolve({ kind: 'language', purpose });
      const chat = await bundle({ scope, binding: selected, purpose });
      let summary: ModelExecutionBundle | undefined;
      if (scope.graph.purposes.defaults.summary || scope.graph.purposes.defaults.chat) {
        summary = await bundle({ scope, binding: await scope.resolve({ kind: 'language', purpose: 'summary' }), purpose: 'summary' });
      }
      const perception: ModelExecutionBundle[] = [];
      const perceptionIds = providerPurposeProfiles({ graph: scope.graph, context, purpose: 'perception' });
      const perceptionSource = perceptionIds.length ? (await scope.resolve({ kind: 'language', purpose: 'perception' })).source : undefined;
      for (const id of perceptionIds) {
        const candidate = scope.graph.profiles[id];
        if (!candidate) throw new ProviderError('profile-not-found');
        // Only declared candidates from the immutable graph; no new model discovery.
        const unbound = resolveProviderProfile({ graph: scope.graph, context, kind: 'language',
          profile: createProfileReference({ binding: {
            graphRevision: scope.graph.revision, profile: candidate,
            account: scope.graph.accounts[candidate.accountId],
            service: scope.graph.services[scope.graph.accounts[candidate.accountId].serviceId],
            model: scope.graph.services[scope.graph.accounts[candidate.accountId].serviceId].models[candidate.model],
          }, kind: 'language' }), purpose: 'perception' });
        const binding = await scope.resolve({ kind: 'language', profile: createProfileReference({ binding: unbound, kind: 'language' }), purpose: 'perception' });
        perception.push(await bundle({ scope, binding: { ...binding, source: perceptionSource }, purpose: 'perception' }));
      }
      let release: Promise<void> | undefined;
      return Object.freeze({ chat, ...(summary ? { summary } : {}),
        ...(perception[0] ? { perception: perception[0] } : {}),
        ...(perception.length > 1 ? { perceptionFallbacks: Object.freeze(perception.slice(1)) } : {}),
        graph: scope.graph, context: scope.context, inference: scope.client, inferenceSnapshot: scope.snapshot, resolve: scope.resolve,
        summarySource: scope.graph.purposes.defaults.summary ? 'runtime' as const : 'deployment-chat' as const,
        policyRevision: scope.graph.revision,
        retainDelegation: () => {
          if (release) throw new ModelRuntimeError('not-prepared');
          scope.signal.throwIfAborted();
          // Synchronous retention precedes any queueing/metadata awaits.
          const retained = input.snapshots.retain(input.lease);
          let child: Promise<ModelExecutionScope> | undefined;
          let childScope: ModelExecutionScope | undefined;
          let closed: Promise<void> | undefined;
          const close = (): Promise<void> => closed ??= (async () => {
            try { await child?.catch(() => undefined); await childScope?.release(); }
            finally { retained.release(); }
          })();
          return Object.freeze({
            acquire: (childInput: Parameters<ModelDelegationAuthority['acquire']>[0]) => {
              if (closed || child) throw new ModelRuntimeError('invalid-context');
              child = this.#acquire({ lease: retained, snapshots: input.snapshots,
                context: { ...context, operationId: childInput.operationId, sessionKey: childInput.sessionKey,
                  ...(childInput.epoch !== undefined ? { epoch: childInput.epoch } : {}) },
                bindingName: childInput.bindingName, signal: childInput.signal, inferenceSnapshot: scope.snapshot,
              }, true).then(acquired => { childScope = acquired; return acquired; });
              return child.then(acquired => Object.freeze({ ...acquired, release: close }));
            },
            release: close,
          });
        },
        release: () => release ??= (async () => { try { await scope.close(); } finally { runtime.retire(); } })(),
      });
    } catch (error) {
      await scope.close(); runtime.retire(); throw error;
    }
  }
  /** Closing an Agent generation does not cancel unrelated business operations. */
  async dispose(): Promise<void> { this.#closed = true; }
}
