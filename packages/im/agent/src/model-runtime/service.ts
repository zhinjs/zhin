import {
  createProfileReference, providerPurposeSelections,
  type ExecutionBinding, type InferenceOperationScope, type LanguagePurpose, type ProviderSelectionSource,
} from '@zhin.js/ai/provider';
import { createInvocationCompletion, invocationModel } from './completion.js';
import { getLogger } from '@zhin.js/logger';
import { ModelRuntimeError, type ModelExecutionBundle, type ModelExecutionCandidate, type ModelExecutionScope,
  type ModelDelegationAuthority, type ModelContextAcquireInput, type ModelRuntimeServiceOptions, type ModelTurnAcquireInput,
  type SubAgentModelKey } from './types.js';

const logger = getLogger('ai.model-runtime');

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
 * Absolute wall-clock cap on one engagement's retained delegation authority.
 * Delegated work normally ends long before this; the cap only guarantees a
 * stuck or forgotten engagement cannot pin its generation's inference scope
 * (and every child operation still open) forever. Past it, the reservation is
 * released, its open child operations are closed and further `acquire` calls
 * fail with `invalid-context`. Not configurable on purpose: it is a leak bound,
 * not a budget (engagement budgets bound the work itself).
 */
export const MAX_DELEGATION_RETENTION_MS = 30 * 60_000;

/**
 * Purpose for one model operation (#1250 agent-purpose-binding-ignored).
 *
 * `purposes.agents` is one key space shared by Agent bindings (`ai.agents.<binding>`,
 * the legacy migration writes those keys, and binding turns resolve
 * `agent:<binding>`) and sub-agents. A sub-agent is looked up by its
 * plugin-qualified name (`<plugin>__<agent>`, the canonical key) first; its bare
 * name is accepted only when no other sub-agent of the turn shares it and no
 * binding uses it. A sub-agent never resolves to a binding's purpose: without a
 * usable key of its own it runs on `chat`.
 */
export function selectLanguagePurpose(
  graph: InferenceOperationScope['graph'],
  input: Readonly<{ bindingName?: string; agent?: SubAgentModelKey }>,
  bindingNames: ReadonlySet<string>,
): 'chat' | `agent:${string}` {
  const agent = input.agent;
  if (agent && agent.name !== 'zhin') {
    const agents = graph.purposes.agents ?? {};
    const configured = (key: string) => Object.hasOwn(agents, key) && Boolean(agents[key]);
    const qualified = agent.qualifiedName?.trim();
    if (qualified && configured(qualified)) {
      if (!bindingNames.has(qualified)) return `agent:${qualified}`;
      logger.warn(`sub-agent ${qualified}: purposes.agents.${qualified} belongs to the Agent binding of that name; using chat`);
    } else if (configured(agent.name)) {
      if (bindingNames.has(agent.name)) {
        logger.warn(`sub-agent ${agent.name}: purposes.agents.${agent.name} belongs to the Agent binding of that name; `
          + `key the sub-agent by its qualified name${qualified ? ` (${qualified})` : ''}; using chat`);
      } else if (agent.bareNameShared) {
        logger.warn(`sub-agent ${agent.name}: purposes.agents.${agent.name} is ambiguous (several sub-agents share the name); `
          + `key it by the qualified name${qualified ? ` (${qualified})` : ''}; using chat`);
      } else {
        return `agent:${agent.name}`;
      }
    }
    return 'chat';
  }
  return !input.bindingName || input.bindingName === 'zhin' ? 'chat' : `agent:${input.bindingName}`;
}

/** Agent integration only. Host persists configuration and owns authentication; this
 * class borrows the exact operation generation and never creates Provider directories. */
export class ModelRuntimeService {
  #closed = false;
  constructor(private readonly options: ModelRuntimeServiceOptions) {}

  #bindingNames(): ReadonlySet<string> {
    return new Set(['zhin', ...(this.options.bindingNames?.() ?? [])]);
  }

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
      const purpose = selectLanguagePurpose(scope.graph, input, this.#bindingNames());
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
            clearTimeout(expiry);
            retained.retirementSignal.removeEventListener('abort', onRetired);
            try {
              await Promise.allSettled([...children].map(async child => (await child).release()));
            } finally { retained.release(); }
          })();
          // The host bounds the reservation: a retired generation never waits for delegated work.
          const onRetired = () => { void close().catch(() => undefined); };
          // ...and so does the wall clock: see MAX_DELEGATION_RETENTION_MS.
          const expiry = setTimeout(() => {
            logger.warn(`model delegation held for ${MAX_DELEGATION_RETENTION_MS / 60_000} min; releasing it and its open operations`);
            onRetired();
          }, MAX_DELEGATION_RETENTION_MS);
          expiry.unref?.();
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
