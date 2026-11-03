import { modelRuntimeBaselineToken, type ModelExecutionScope, type ModelRuntimeService, type ModelTurnResolveInput,
  type ModelExecutionLease, type HostModelSelection, type HostProviderLease } from '@zhin.js/agent/model-runtime';
import type { RuntimeControlContext } from '@zhin.js/runtime';

export type ModelConfigurationControl = <T>(operation: (context: RuntimeControlContext) => Promise<T>, existing?: RuntimeControlContext) => Promise<T>;
export interface ModelConfigurationAccess {
  withRuntime<T>(operation: (runtime: ModelRuntimeService) => Promise<T>, existing?: RuntimeControlContext): Promise<T>;
  acquire(input: (runtime: ModelRuntimeService) => Promise<ModelTurnResolveInput>, signal?: AbortSignal, existing?: RuntimeControlContext): Promise<ModelExecutionScope>;
  acquireHostModel(selection?: HostModelSelection, signal?: AbortSignal): Promise<ModelExecutionLease>;
  acquireHostScope(input: (runtime: ModelRuntimeService) => HostModelSelection | undefined, signal?: AbortSignal): Promise<ModelExecutionScope>;
  acquireHostProvider(alias: string, signal?: AbortSignal): Promise<HostProviderLease>;
  acquireHostCompletion(bindingName: string, model?: string, signal?: AbortSignal): Promise<HostProviderLease & { readonly model: string }>;
}

/** Host-private admission; the configuration lease never substitutes for the message's authority. */
export function createModelConfigurationAccess(options: Readonly<{
  control?: ModelConfigurationControl;
  runtime: () => ModelRuntimeService;
}>): ModelConfigurationAccess {
  const current = (context: RuntimeControlContext): ModelRuntimeService => {
    const runtime = context.readRootResource(modelRuntimeBaselineToken);
    if (!runtime) throw new Error('Current model configuration is unavailable');
    return runtime;
  };
  const acquireCaptured = async <P, L extends { release(): Promise<void> }>(
    resolve: (runtime: ModelRuntimeService) => P | Promise<P>,
    acquire: (runtime: ModelRuntimeService, plan: P) => Promise<L>,
    signal?: AbortSignal, existing?: RuntimeControlContext,
  ): Promise<L> => {
    const captured = options.control ? await options.control(async context => {
      signal?.throwIfAborted();
      const runtime = current(context);
      const plan = await resolve(runtime);
      signal?.throwIfAborted();
      return { runtime, plan, lease: context.retain() };
    }, existing) : await (async () => {
      signal?.throwIfAborted();
      const runtime = options.runtime();
      return { runtime, plan: await resolve(runtime), lease: undefined };
    })();
    try {
      const resource = await acquire(captured.runtime, captured.plan);
      let released: Promise<void> | undefined;
      return Object.freeze({ ...resource, release: () => released ??= (async () => {
        try { await resource.release(); }
        finally { captured.lease?.release(); }
      })() });
    } catch (error) { captured.lease?.release(); throw error; }
  };
  return Object.freeze({
    withRuntime: <T>(operation: (runtime: ModelRuntimeService) => Promise<T>, existing?: RuntimeControlContext) => options.control
      ? options.control(context => operation(current(context)), existing)
      : operation(options.runtime()),
    acquire: (input: (runtime: ModelRuntimeService) => Promise<ModelTurnResolveInput>, signal?: AbortSignal, existing?: RuntimeControlContext) =>
      acquireCaptured(async runtime => runtime.resolveForTurn(await input(runtime)),
        (runtime, plan) => runtime.acquireResolvedForTurn(plan, signal), signal, existing),
    acquireHostModel: (selection?: HostModelSelection, signal?: AbortSignal) =>
      acquireCaptured(runtime => runtime.resolveHostModel(selection), (runtime, plan) => runtime.acquireResolvedHostModel(plan, signal), signal),
    acquireHostScope: (input: (runtime: ModelRuntimeService) => HostModelSelection | undefined, signal?: AbortSignal) =>
      acquireCaptured(runtime => runtime.resolveHostScope(input(runtime)), (runtime, plan) => runtime.acquireResolvedForTurn(plan, signal), signal),
    acquireHostProvider: (alias: string, signal?: AbortSignal) =>
      acquireCaptured(runtime => runtime.resolveHostProvider(alias), (runtime, plan) => runtime.acquireResolvedHostProvider(plan, signal), signal),
    acquireHostCompletion: (bindingName: string, model?: string, signal?: AbortSignal) => acquireCaptured(runtime => {
      const binding = runtime.getCompatibilityRouting().agents[bindingName];
      if (!binding) throw new Error(`AI completion: agent binding "${bindingName}" not found`);
      return { provider: runtime.resolveHostProvider(binding.provider), model: model ?? binding.model };
    }, async (runtime, plan) => ({ ...await runtime.acquireResolvedHostProvider(plan.provider, signal), model: plan.model }), signal),
  });
}
