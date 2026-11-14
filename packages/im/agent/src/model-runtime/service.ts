import {
  createProfileReference, providerPurposeSelections,
  type ExecutionBinding, type InferenceOperationScope, type LanguagePurpose, type ProviderSelectionSource,
} from '@zhin.js/ai/provider';
import { createInvocationCompletion, invocationModel } from './completion.js';
import { ModelRuntimeError, type ModelExecutionBundle, type ModelExecutionCandidate, type ModelExecutionScope,
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

/**
 * `agent:<name>` for a sub-agent whose purpose is configured, else the binding's
 * purpose (`chat` for `zhin`). A sub-agent without its own purpose falls back to
 * chat instead of failing (#1250 agent-purpose-binding-ignored).
 */
function selectLanguagePurpose(
  graph: InferenceOperationScope['graph'],
  input: Readonly<{ bindingName?: string; agent?: string }>,
): 'chat' | `agent:${string}` {
  const agent = input.agent?.trim();
  if (agent && agent !== 'zhin' && graph.purposes.agents?.[agent]) return `agent:${agent}`;
  return !input.bindingName || input.bindingName === 'zhin' ? 'chat' : `agent:${input.bindingName}`;
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
      const purpose = selectLanguagePurpose(scope.graph, input);
      const selected = await scope.resolve({ kind: 'language', purpose });
      const chat = await bundle({ scope, binding: selected, purpose });
      const candidate = (options: Readonly<{
        profileId: string;
        source?: ProviderSelectionSource;
        resolve: (binding: ExecutionBinding) => Promise<ModelExecutionBundle>;
      }>): ModelExecutionCandidate => {
        let pending: Promise<ModelExecutionBundle> | undefined;
        const profile = scope.graph.profiles[options.profileId];
        const account = scope.graph.accounts[profile.accountId];
        const service = scope.graph.services[account.serviceId];
        const binding = Object.freeze({ graphRevision: scope.graph.revision, profile, account, service, model: service.models[profile.model], ...(options.source ? { source: options.source } : {}) });
        return Object.freeze({ binding,
          resolve: async () => {
            scope.signal.throwIfAborted();
            return pending ??= options.resolve(binding);
          } });
      };
      let summary: ModelExecutionCandidate | undefined;
      if (scope.graph.purposes.defaults.summary || scope.graph.purposes.defaults.chat) {
        summary = candidate({ profileId: scope.graph.purposes.defaults.summary ?? scope.graph.purposes.defaults.chat!, resolve: async () =>
          bundle({ scope, binding: await scope.resolve({ kind: 'language', purpose: 'summary' }), purpose: 'summary' }) });
      }
      const perception: ModelExecutionCandidate[] = [];
      for (const { id, source } of providerPurposeSelections({ graph: scope.graph, context, purpose: 'perception' })) {
        perception.push(candidate({ profileId: id, source, resolve: async declaration => {
          // Resolve and validate only the candidate now being attempted.
          const binding = await scope.resolve({ kind: 'language',
            profile: createProfileReference({ binding: declaration, kind: 'language' }), purpose: 'perception' });
          return bundle({ scope, binding: { ...binding, source }, purpose: 'perception' });
        } }));
      }
      let release: Promise<void> | undefined;
      return Object.freeze({ chat, purpose, ...(summary ? { summary } : {}),
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
          const children = new Set<Promise<ModelExecutionScope>>();
          let closed: Promise<void> | undefined;
          const close = (): Promise<void> => closed ??= (async () => {
            retained.retirementSignal.removeEventListener('abort', onRetired);
            try {
              await Promise.allSettled([...children].map(async child => (await child).release()));
            } finally { retained.release(); }
          })();
          // The host bounds the reservation: a retired generation never waits for delegated work.
          const onRetired = () => { void close().catch(() => undefined); };
          if (retained.retirementSignal.aborted) onRetired();
          else retained.retirementSignal.addEventListener('abort', onRetired, { once: true });
          return Object.freeze({
            acquire: (childInput: Parameters<ModelDelegationAuthority['acquire']>[0]) => {
              if (closed || !retained.active) throw new ModelRuntimeError('invalid-context');
              const child: Promise<ModelExecutionScope> = this.#acquire({ lease: retained, snapshots: input.snapshots,
                context: { ...context, operationId: childInput.operationId, sessionKey: childInput.sessionKey,
                  ...(childInput.epoch !== undefined ? { epoch: childInput.epoch } : {}) },
                bindingName: childInput.bindingName, agent: childInput.agent, signal: childInput.signal, inferenceSnapshot: scope.snapshot,
              }, true).then(acquired => {
                let childRelease: Promise<void> | undefined;
                return Object.freeze({ ...acquired, release: () => childRelease ??= (async () => {
                  children.delete(child);
                  await acquired.release();
                })() });
              });
              children.add(child);
              void child.catch(() => children.delete(child));
              return child;
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
