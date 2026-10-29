/**
 * Real-model source for the eval driver (#723 nightly tier).
 *
 * Exposes the same {@link ScriptedModel} surface the driver already consumes,
 * but every request is forwarded to a real {@link LlmCompletionPort} (usually
 * the nightly BudgetedCompletionPort) instead of a script. Requests are
 * recorded with the tool calls the model actually made, so live semantic
 * checks and failure reports read the same fields as scripted runs.
 */
import {
  createAssistantMessageEventStream,
  LlmApiRuntime,
  SdkProviderAdapter,
  type Context,
  type LlmCompletionPort,
  type Model,
  type StreamOptions,
} from '@zhin.js/ai';
import type { ScriptedModel, ScriptedModelRequest } from './scripted-model.js';
import { contextText, countImages, lastUserText, toolSchemaTextOf } from './scripted-model.js';

export interface LiveModelOptions {
  /** Real completion port; budgets and timeouts are its responsibility. */
  readonly port: LlmCompletionPort;
  /** Real model descriptor the port is called with. */
  readonly model: Model;
  /** Context window reported to the harness (defaults to the model's own). */
  readonly contextWindow?: number;
}

const PROVIDER_ALIAS = 'eval-live';

export function createLiveModel(options: LiveModelOptions): ScriptedModel {
  const modelId = options.model.id;
  const provider = new SdkProviderAdapter(PROVIDER_ALIAS, 'openai', { sdk: 'openai', apiKey: 'eval' }, [modelId]);
  const runtime = new LlmApiRuntime((alias) => (alias === PROVIDER_ALIAS ? [modelId] : []));
  const contextWindow = options.contextWindow ?? options.model.contextWindow;
  runtime.registerProvider(PROVIDER_ALIAS, {
    sdk: 'openai',
    apiKey: 'eval',
    ...(contextWindow ? { contextWindow } : {}),
    // Declare the real model's modalities so the harness forwards turn images to it.
    ...(options.model.input?.length ? { input: [...options.model.input] } : {}),
  }, [modelId]);
  const requests: ScriptedModelRequest[] = [];

  const stream = (_model: Model, context: Context, streamOptions?: StreamOptions) =>
    createAssistantMessageEventStream(async (push) => {
      const index = requests.length;
      const message = await options.port.complete(options.model, context, {
        ...(streamOptions?.signal ? { signal: streamOptions.signal } : {}),
        ...(streamOptions?.maxTokens ? { maxTokens: streamOptions.maxTokens } : {}),
        ...(streamOptions?.outputSchema ? { outputSchema: streamOptions.outputSchema } : {}),
      });
      requests.push({
        index,
        offeredTools: (context.tools ?? []).map((tool) => tool.name),
        toolCalls: message.content.flatMap((block) => (block.type === 'toolCall' ? [block.name] : [])),
        lastUserText: lastUserText(context),
        inputText: contextText(context),
        systemPrompt: context.systemPrompt ?? '',
        toolSchemaText: toolSchemaTextOf(context),
        model: modelId,
        images: countImages(context),
      });
      const text = message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text) push({ type: 'text_delta', text });
      return { ...message, provider: PROVIDER_ALIAS, model: modelId };
    });
  runtime.registerApiProvider({ api: 'ai-sdk', stream, streamSimple: stream });

  return {
    providerAlias: PROVIDER_ALIAS,
    modelId,
    provider,
    runtime,
    requests,
    // A real model only sees offered tools and has no script to exhaust.
    unofferedToolCalls: [],
    unexpectedlyOfferedToolCalls: [],
    modelMismatches: [],
    exhaustedRequests: () => 0,
    remainingSteps: () => 0,
  };
}
