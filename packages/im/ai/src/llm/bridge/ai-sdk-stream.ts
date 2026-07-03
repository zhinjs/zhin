/**
 * AI SDK streamText ↔ pi AssistantMessageEventStream bridge (ADR 0018).
 */

import { generateText, streamText, type SystemModelMessage } from 'ai';
import { formatCompact, Logger } from '@zhin.js/logger';
import type { LanguageModel } from 'ai';
import {
  createAssistantMessageEventStream,
  type StreamFn,
  type StreamOptions,
} from '../api-registry.js';
import type { Model } from '../types/model.js';
import type { Context } from '../types/context.js';
import type { AssistantMessage } from '../types/agent-message.js';
import { EMPTY_TOKEN_USAGE } from '../types/agent-message.js';
import { formatRedactedJson } from '../redact-request-body.js';
import { contextToAiSdkPrompt, llmToolsToAiSdk } from './ai-sdk-messages.js';
import {
  applyPromptCacheToTools,
  buildPromptCacheProviderOptions,
  isStreamPromptCacheEnabled,
  resolvePromptCacheApplyInput,
  wrapSystemForPromptCache,
} from './ai-sdk-prompt-cache.js';
import { getLanguageModel } from '../language-model-store.js';
import { ensureLanguageModelRegistered } from '../register-api-layer.js';
import { getProviderConfig } from '../api-registry.js';

const llmContextLogger = new Logger(null, 'LLM');

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

function buildAssistantMessage(
  model: Model,
  text: string,
  thinking: string,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  stopReason: AssistantMessage['stopReason'],
  usage: AssistantMessage['usage'],
): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (text) content.push({ type: 'text', text });
  if (thinking) content.push({ type: 'thinking', thinking });
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
      const { system: systemText, messages } = contextToAiSdkPrompt(context);
      const system: string | SystemModelMessage | undefined = wrapSystemForPromptCache(systemText, cacheCtx);
      const tools = applyPromptCacheToTools(llmToolsToAiSdk(context.tools), cacheCtx);
      const hasDeferredTools = context.tools?.some(t => t.deferLoading) === true;
      const cacheOpts = buildPromptCacheProviderOptions(cacheCtx);
      const providerOptions =
        hasDeferredTools && model.sdk === 'anthropic'
          ? {
              ...(cacheOpts ?? {}),
              anthropic: {
                ...(cacheOpts?.anthropic ?? {}),
                betas: ['advanced-tool-use-2025-11-20'],
              },
            }
          : cacheOpts;

      llmContextLogger.debug(formatCompact({
        op: 'ai_sdk_request',
        provider: model.provider,
        model: model.id,
        api: model.api,
        sdk: model.sdk,
        prompt_cache: cacheCtx.enabled || undefined,
        prompt_cache_key: cacheCtx.cacheKey,
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
      });

      let text = '';
      let thinking = '';
      const toolCalls = new Map<string, { id: string; name: string; arguments: Record<string, unknown> }>();
      const toolInputBuffers = new Map<string, string>();

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          text += part.text;
          push({ type: 'text_delta', text: part.text });
        } else if (part.type === 'reasoning-delta') {
          thinking += part.text;
          push({ type: 'thinking_delta', thinking: part.text });
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

      const finalText = await final.text;
      const finishReason = await final.finishReason;
      const finalUsage = await final.usage;

      const calls = [...toolCalls.values()];
      const assistant = buildAssistantMessage(
        model,
        text || finalText,
        thinking,
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
  const { system: systemText, messages } = contextToAiSdkPrompt(context);
  const system: string | SystemModelMessage | undefined = wrapSystemForPromptCache(systemText, cacheCtx);
  const tools = applyPromptCacheToTools(llmToolsToAiSdk(context.tools), cacheCtx);
  const hasDeferredTools = context.tools?.some(t => t.deferLoading) === true;
  const providerOptions = {
    ...buildPromptCacheProviderOptions(cacheCtx),
    ...(hasDeferredTools && model.sdk === 'anthropic'
      ? { anthropic: { betas: ['advanced-tool-use-2025-11-20'] } }
      : {}),
  };

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
  });

  const toolCalls = result.toolCalls.map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    arguments: ('input' in call ? call.input : {}) as Record<string, unknown>,
  }));

  return buildAssistantMessage(
    model,
    result.text,
    '',
    toolCalls,
    mapFinishReason(result.finishReason, toolCalls.length > 0),
    usageFromAiSdk(result.usage),
  );
}
