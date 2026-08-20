/**
 * AI SDK streamText ↔ pi AssistantMessageEventStream bridge (ADR 0018).
 */

import { generateText, Output, jsonSchema, streamText, type SystemModelMessage, type LanguageModel, type JSONValue } from 'ai';
import { formatCompact, getLogger } from '@zhin.js/logger';

import { createAssistantMessageEventStream, getProviderConfig, type StreamFn, type StreamOptions } from '../api-registry.js';
import type { Model } from '../types/model.js';
import type { Context } from '../types/context.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../types/agent-message.js';
import type { AnthropicThinkingProviderOptions, ThinkingContentBlock } from '../types/content-block.js';

import { formatRedactedJson } from '../redact-request-body.js';
import {
  contextToAiSdkPrompt,
  llmToolsToAiSdk,
  shouldEnsureToolCallReasoning,
  TOOL_CALL_REASONING_PLACEHOLDER,
  usesAnthropicReasoningProtocol,
} from './ai-sdk-messages.js';
import {
  applyPromptCacheToTools,
  buildPromptCacheProviderOptions,
  isStreamPromptCacheEnabled,
  resolvePromptCacheApplyInput,
  wrapSystemForPromptCache,
} from './ai-sdk-prompt-cache.js';
import { getLanguageModel } from '../language-model-store.js';
import { ensureLanguageModelRegistered } from '../register-api-layer.js';

const llmContextLogger = getLogger('LLM');

/** StreamOptions.outputSchema → AI SDK structured output 规格（Output.object）。 */
function buildStructuredOutputSpec(schema: Record<string, unknown> | undefined) {
  if (!schema) return undefined;
  return Output.object({
    schema: jsonSchema(schema),
    name: 'zhin_outbound',
    description: 'zhin AI 出站消息（text / mentions / segments 消息段数组）',
  });
}

/** 读取 structured output；仅在显式配置 outputSchema 时启用（AI SDK v7 无 schema 时 output 也可能是纯文本 string）。 */
async function readStructuredOutput(
  source: unknown,
  enabled: boolean,
): Promise<unknown> {
  if (!enabled) return undefined;
  try {
    const output = (source as { output?: PromiseLike<unknown> | unknown } | undefined)?.output;
    if (output == null) return undefined;
    return await Promise.resolve(output);
  } catch {
    return undefined;
  }
}

/** structured → assistant text；string 不再二次 JSON.stringify。 */
function formatStructuredAsAssistantText(structured: unknown): string {
  if (typeof structured === 'string') return structured;
  return JSON.stringify(structured);
}

function mapFinishReason(
  reason: string | undefined,
  hasToolCalls: boolean,
): AssistantMessage['stopReason'] {
  if (hasToolCalls || reason === 'tool-calls') return 'toolCalls';
  if (reason === 'length') return 'length';
  return 'stop';
}

function usageFromAiSdk(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
} | undefined): AssistantMessage['usage'] {
  if (!usage) return { ...EMPTY_TOKEN_USAGE };
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const totalTokens = usage.totalTokens ?? input + output;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: { ...EMPTY_TOKEN_USAGE.cost },
  };
}

type CapturedThinkingPart = {
  text: string;
  providerOptions?: AnthropicThinkingProviderOptions;
};

function anthropicOptionsFromProviderMetadata(
  metadata: unknown,
): AnthropicThinkingProviderOptions | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const anthropic = (metadata as { anthropic?: unknown }).anthropic;
  if (!anthropic || typeof anthropic !== 'object') return undefined;
  const record = anthropic as { signature?: unknown; redactedData?: unknown };
  const signature = typeof record.signature === 'string' ? record.signature : undefined;
  const redactedData = typeof record.redactedData === 'string' ? record.redactedData : undefined;
  if (signature === undefined && redactedData === undefined) return undefined;
  return {
    anthropic: {
      ...(signature !== undefined ? { signature } : {}),
      ...(redactedData !== undefined ? { redactedData } : {}),
    },
  };
}

function mergeAnthropicOptions(
  left: AnthropicThinkingProviderOptions | undefined,
  right: AnthropicThinkingProviderOptions | undefined,
): AnthropicThinkingProviderOptions | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    anthropic: {
      ...left.anthropic,
      ...right.anthropic,
    },
  };
}

/** Prefer AI SDK reasoning parts (with signature metadata); fall back to streamed text. */
function resolveThinkingParts(input: {
  streamedText: string;
  finalText: string;
  reasoningParts: ReadonlyArray<{ text?: string; providerMetadata?: unknown }> | undefined;
}): CapturedThinkingPart[] {
  const fromSdk = (input.reasoningParts ?? [])
    .map((part): CapturedThinkingPart | undefined => {
      const text = typeof part.text === 'string' ? part.text : '';
      const providerOptions = anthropicOptionsFromProviderMetadata(part.providerMetadata);
      if (!text && !providerOptions?.anthropic?.redactedData) return undefined;
      return { text, providerOptions };
    })
    .filter((part): part is CapturedThinkingPart => part !== undefined);

  if (fromSdk.length > 0) return fromSdk;

  const text = input.streamedText || input.finalText || '';
  return text ? [{ text }] : [];
}

function buildAssistantMessage(
  model: Model,
  text: string,
  thinkingParts: readonly CapturedThinkingPart[],
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  stopReason: AssistantMessage['stopReason'],
  usage: AssistantMessage['usage'],
): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (text) content.push({ type: 'text', text });

  const parts = [...thinkingParts];
  // Persist a placeholder CoT when gateway omitted reasoning on tool_calls (DeepSeek round-trip).
  if (
    parts.length === 0
    && toolCalls.length > 0
    && shouldEnsureToolCallReasoning(model)
  ) {
    parts.push({ text: TOOL_CALL_REASONING_PLACEHOLDER });
  }

  for (const part of parts) {
    const block: ThinkingContentBlock = {
      type: 'thinking',
      thinking: part.text,
    };
    if (part.providerOptions) block.providerOptions = part.providerOptions;
    content.push(block);
  }

  for (const call of toolCalls) {
    content.push({
      type: 'toolCall',
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    });
  }
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

type ProviderOpts = Record<string, Record<string, JSONValue>>;

function buildProviderOptions(
  sdk: string | undefined,
  cacheOpts: ProviderOpts | undefined,
  hasDeferredTools: boolean,
): ProviderOpts | undefined {
  const opts: ProviderOpts = { ...(cacheOpts ?? {}) };

  if (hasDeferredTools && sdk === 'anthropic') {
    opts.anthropic = {
      ...(cacheOpts?.anthropic ?? {}),
      betas: ['advanced-tool-use-2025-11-20'],
    };
  }

  if (sdk === 'minimax') {
    opts.minimax = { thinking: { type: 'adaptive' } };
  }

  return Object.keys(opts).length > 0 ? opts : undefined;
}

function reasoningDeltaText(part: { text?: unknown; delta?: unknown }): string {
  if (typeof part.text === 'string' && part.text.length > 0) return part.text;
  if (typeof part.delta === 'string' && part.delta.length > 0) return part.delta;
  return '';
}

export function createAiSdkStreamFn(): StreamFn {
  return (model, context, options) => {
    return createAssistantMessageEventStream(async (push) => {
      let languageModel = getLanguageModel(model.provider, model.id);
      if (!languageModel) {
        const entry = getProviderConfig(model.provider);
        if (entry) {
          ensureLanguageModelRegistered(model.provider, model.id, entry.config);
          languageModel = getLanguageModel(model.provider, model.id);
        }
      }
      if (!languageModel) {
        throw new Error(`No LanguageModel registered for provider ${model.provider}`);
      }

      const cacheCtx = resolvePromptCacheApplyInput(
        isStreamPromptCacheEnabled(options?.promptCache),
        model.sdk,
        options,
      );
      const { system: systemText, messages } = contextToAiSdkPrompt(context, undefined, {
        ensureToolCallReasoning: shouldEnsureToolCallReasoning(model),
        sdk: model.sdk,
      });
      const system: string | SystemModelMessage | undefined = wrapSystemForPromptCache(systemText, cacheCtx);
      const tools = applyPromptCacheToTools(llmToolsToAiSdk(context.tools), cacheCtx);
      const hasDeferredTools = context.tools?.some(t => t.deferLoading) === true;
      const cacheOpts = buildPromptCacheProviderOptions(cacheCtx);
      const providerOptions = buildProviderOptions(model.sdk, cacheOpts, hasDeferredTools);

      llmContextLogger.debug(formatCompact({
        op: 'ai_sdk_request',
        provider: model.provider,
        model: model.id,
        api: model.api,
        sdk: model.sdk,
        prompt_cache: cacheCtx.enabled || undefined,
        prompt_cache_key: cacheCtx.cacheKey,
        anthropic_reasoning_protocol: usesAnthropicReasoningProtocol(model.sdk) || undefined,
        messages: formatRedactedJson(messages),
        tools: tools ? Object.keys(tools).length : 0,
      }));

      options?.onPayload?.({ system, messages, tools: tools ? Object.keys(tools) : [] });

      const result = streamText({
        model: languageModel,
        system,
        messages,
        tools,
        toolChoice: tools ? 'auto' : undefined,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens ?? model.maxTokens,
        abortSignal: options?.signal,
        providerOptions,
        output: buildStructuredOutputSpec(options?.outputSchema),
      });

      let text = '';
      let thinking = '';
      let streamedThinkingOptions: AnthropicThinkingProviderOptions | undefined;
      const toolCalls = new Map<string, { id: string; name: string; arguments: Record<string, unknown> }>();
      const toolInputBuffers = new Map<string, string>();

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          text += part.text;
          push({ type: 'text_delta', text: part.text });
        } else if (part.type === 'reasoning-delta') {
          const chunk = reasoningDeltaText(part);
          if (chunk) {
            thinking += chunk;
            push({ type: 'thinking_delta', thinking: chunk });
          }
          streamedThinkingOptions = mergeAnthropicOptions(
            streamedThinkingOptions,
            anthropicOptionsFromProviderMetadata(part.providerMetadata),
          );
        } else if (part.type === 'tool-input-start') {
          toolInputBuffers.set(part.id, '');
        } else if (part.type === 'tool-input-delta') {
          const prev = toolInputBuffers.get(part.id) ?? '';
          toolInputBuffers.set(part.id, prev + part.delta);
        } else if (part.type === 'tool-call') {
          let args: Record<string, unknown> = {};
          if ('input' in part && part.input && typeof part.input === 'object') {
            args = part.input as Record<string, unknown>;
          } else {
            const raw = toolInputBuffers.get(part.toolCallId) ?? '{}';
            try {
              args = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              args = {};
            }
          }
          toolCalls.set(part.toolCallId, {
            id: part.toolCallId,
            name: part.toolName,
            arguments: args,
          });
          push({
            type: 'toolcall_delta',
            toolCall: { id: part.toolCallId, name: part.toolName, arguments: args },
          });
        } else if (part.type === 'error') {
          const err = part.error instanceof Error ? part.error : new Error(String(part.error));
          throw err;
        }
      }

      const final = await result;
      options?.onResponse?.(final.response);

      const structured = await readStructuredOutput(final, Boolean(options?.outputSchema));
      const finalText = await final.text;
      const finalReasoning = await Promise.resolve(final.reasoningText).catch(() => '');
      const finalReasoningParts = await Promise.resolve(final.reasoning).catch(() => undefined);
      const finishReason = await final.finishReason;
      const finalUsage = await final.usage;

      const calls = [...toolCalls.values()];
      const resolvedText = structured !== undefined
        ? formatStructuredAsAssistantText(structured)
        : (text || finalText);
      let thinkingParts = resolveThinkingParts({
        streamedText: thinking,
        finalText: finalReasoning || '',
        reasoningParts: finalReasoningParts,
      });
      // If SDK returned plain text without metadata but stream captured a signature, attach it.
      if (
        thinkingParts.length === 1
        && !thinkingParts[0]?.providerOptions
        && streamedThinkingOptions
      ) {
        thinkingParts = [{
          text: thinkingParts[0]!.text,
          providerOptions: streamedThinkingOptions,
        }];
      }
      const assistant = buildAssistantMessage(
        model,
        resolvedText,
        thinkingParts,
        calls,
        mapFinishReason(finishReason, calls.length > 0),
        usageFromAiSdk(finalUsage),
      );
      return assistant;
    });
  };
}

/** Non-streaming complete via AI SDK generateText (legacy service.chat paths). */
export async function generateTextViaAiSdk(
  languageModel: LanguageModel,
  model: Model,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const cacheCtx = resolvePromptCacheApplyInput(
    isStreamPromptCacheEnabled(options?.promptCache),
    model.sdk,
    options,
  );
  const { system: systemText, messages } = contextToAiSdkPrompt(context, undefined, {
    ensureToolCallReasoning: shouldEnsureToolCallReasoning(model),
    sdk: model.sdk,
  });
  const system: string | SystemModelMessage | undefined = wrapSystemForPromptCache(systemText, cacheCtx);
  const tools = applyPromptCacheToTools(llmToolsToAiSdk(context.tools), cacheCtx);
  const hasDeferredTools = context.tools?.some(t => t.deferLoading) === true;
  const providerOptions = buildProviderOptions(model.sdk, buildPromptCacheProviderOptions(cacheCtx), hasDeferredTools);

  const result = await generateText({
    model: languageModel,
    system,
    messages,
    tools,
    toolChoice: tools ? 'auto' : undefined,
    temperature: options?.temperature,
    maxOutputTokens: options?.maxTokens ?? model.maxTokens,
    abortSignal: options?.signal,
    providerOptions,
    output: buildStructuredOutputSpec(options?.outputSchema),
  });

  const structured = await readStructuredOutput(result, Boolean(options?.outputSchema));
  const toolCalls = result.toolCalls.map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    arguments: ('input' in call ? call.input : {}) as Record<string, unknown>,
  }));

  return buildAssistantMessage(
    model,
    structured !== undefined ? formatStructuredAsAssistantText(structured) : result.text,
    resolveThinkingParts({
      streamedText: '',
      finalText: result.reasoningText ?? '',
      reasoningParts: result.reasoning,
    }),
    toolCalls,
    mapFinishReason(result.finishReason, toolCalls.length > 0),
    usageFromAiSdk(result.usage),
  );
}
