import { resolveEffectiveOutputTokens, type LlmCompletionPort, type Model, type StreamOptions, type AssistantMessage, type Context } from '@zhin.js/ai';
import { createProfileReference, ProviderError, type ExecutionBinding, type InferenceClient, type LanguagePurpose, type ProviderExecutionTraits } from '@zhin.js/ai/provider';

/** Metadata for the already selected model. It never resolves an alias or creates an SDK. */
export function invocationModel(binding: ExecutionBinding, traits: ProviderExecutionTraits = {}): Model {
  return Object.freeze({ id: binding.model.id, name: binding.profile.label ?? binding.profile.id,
    provider: binding.account.id, api: 'provider', ...traits, input: [...binding.model.input ?? ['text']],
    contextWindow: binding.model.contextWindow ?? 0,
    maxTokens: resolveEffectiveOutputTokens({
      configured: typeof binding.profile.parameters.maxOutputTokens === 'number' ? binding.profile.parameters.maxOutputTokens : undefined,
      declared: binding.model.maxOutputTokens }),
    reasoning: binding.model.thinking });
}
export interface InvocationCompletionOptions {
  readonly binding: ExecutionBinding;
  readonly client: InferenceClient;
  readonly purpose: LanguagePurpose | `agent:${string}`;
}
/** agentLoop's completion port over one fixed inference binding, with no model directory. */
export function createInvocationCompletion(input: InvocationCompletionOptions): LlmCompletionPort {
  const selected = invocationModel(input.binding);
  const profile = createProfileReference({ binding: input.binding, kind: 'language' });
  const complete = async (model: Model, context: Context, options: StreamOptions = {}): Promise<AssistantMessage> => {
    if (model.provider !== selected.provider || model.id !== selected.id || model.api !== selected.api
      || model.contextWindow !== selected.contextWindow || model.maxTokens !== selected.maxTokens
      || model.reasoning !== selected.reasoning || JSON.stringify(model.input) !== JSON.stringify(selected.input)) {
      throw new ProviderError('stale-reference');
    }
    const { signal, ...requestOptions } = options;
    const request = { context, options: requestOptions };
    if (!options.onTextDelta || input.binding.model.streaming !== true) {
      return input.client.generate({ profile, purpose: input.purpose, request, signal });
    }
    const run = await input.client.stream({ profile, purpose: input.purpose, request, signal });
    let result: AssistantMessage | undefined;
    try {
      for await (const event of run) {
        if (event.type === 'text_delta' && event.text) options.onTextDelta(event.text);
        if (event.type === 'error') throw event.error ?? new Error('Inference stream failed');
        if (event.type === 'done' && event.message) result = event.message;
      }
      if (!result) throw new Error('Inference stream ended without a terminal result');
      return result;
    } finally { await run.close(); }
  };
  return Object.freeze({ complete, completeSimple: complete });
}
