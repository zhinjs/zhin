/**
 * AI SDK streamText ↔ pi AssistantMessageEventStream bridge (ADR 0018).
 */

import { generateText, NoObjectGeneratedError, Output, jsonSchema, streamText, type LanguageModel, type JSONValue } from 'ai';
import { formatCompact, getLogger } from '@zhin.js/logger';

import { createAssistantMessageEventStream, type LlmApiRuntime, type StreamFn, type StreamOptions } from '../llm-api-runtime.js';
import type { Model } from '../types/model.js';
import type { ThinkingLevel } from '../types/agent-event.js';
import { promptBlockReason, resolveFinish, type FinishOutcome } from './finish-reason.js';
import { streamPartError } from './stream-error.js';
import { parseLenientJsonObject } from './lenient-json.js';
import { normalizePromptStructuredText, structuredOutputMode, withStructuredOutputInstruction } from './prompt-structured-output.js';
import { toolCallInput } from './tool-call-input.js';
import { observeModelRequest } from './request-observation.js';
import { createToolNameCodec } from './tool-name-wire.js';
import type { Context } from '../types/context.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../types/agent-message.js';
import type { ThinkingContentBlock, ThinkingProviderOptions, ToolCallInputError, ToolCallProviderOptions } from '../types/content-block.js';

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
  applyPromptCacheToMessages,
  buildPromptCacheProviderOptions,
  isStreamPromptCacheEnabled,
  resolvePromptCacheApplyInput,
  wrapSystemForPromptCache,
} from './ai-sdk-prompt-cache.js';

const llmContextLogger = getLogger('LLM');

/** StreamOptions.outputSchema → AI SDK structured output 规格（Output.object）。 */
function buildStructuredOutputSpec(schema: Record<string, unknown> | undefined) {
  if (!schema) return undefined;
  return Output.object({
    schema: jsonSchema(schema),
    name: 'zhin_outbound',
    description: 'Structured response matching the caller-provided JSON Schema',
  });
}

/** 读取 structured output；仅在显式配置 outputSchema 时启用（AI SDK v7 无 schema 时 output 也可能是纯文本 string）。 */
async function readStructuredOutput(
  source: unknown,
  enabled: boolean,
  hasToolCalls: boolean,
  responseText = '',
): Promise<unknown> {
  if (!enabled) return undefined;
  try {
    const output = await (source as { output?: PromiseLike<unknown> | unknown } | undefined)?.output;
    if (output == null) {
      if (hasToolCalls) return undefined;
      throw new Error('Missing structured output');
    }
    return output;
  } catch {
    if (hasToolCalls) return undefined;
    // MiniMax can ignore the SDK's synthetic json tool and return a JSON text
    // block instead. The SDK hides that block; recover from the answer text
    // only, never from thinking.
    const repaired = parseLenientJsonObject(responseText);
    if (repaired !== undefined) return repaired;
    // A plain prose answer is still the answer; the caller's schema decides what to do with it.
    if (responseText.trim() && !responseText.includes('{')) return responseText.trim();
    // SDK errors can include the entire response. Keep the public failure
    // specific to the contract without leaking the response or reasoning.
    throw new Error('Model did not produce the requested structured output');
  }
}

function anthropicTextDelta(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const event = raw as { type?: string; delta?: { type?: string; text?: unknown }; content_block?: { type?: string; text?: unknown } };
  const block = event.type === 'content_block_delta' && event.delta?.type === 'text_delta'
    ? event.delta : event.type === 'content_block_start' && event.content_block?.type === 'text'
      ? event.content_block : undefined;
  return typeof block?.text === 'string' ? block.text : '';
}

function anthropicStartsTool(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const event = raw as { type?: string; content_block?: { type?: string } };
  return event.type === 'content_block_start' && event.content_block?.type === 'tool_use';
}

function anthropicResponseText(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || !('content' in raw) || !Array.isArray(raw.content)) return '';
  if (raw.content.some(block => block?.type === 'tool_use')) return '';
  return raw.content.map(block => block?.type === 'text' && typeof block.text === 'string' ? block.text : '').join('');
}

/** structured → assistant text；string 不再二次 JSON.stringify。 */
function formatStructuredAsAssistantText(structured: unknown): string {
  if (typeof structured === 'string') return structured;
  return JSON.stringify(structured);
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
  outputTokenDetails?: { reasoningTokens?: number };
  reasoningTokens?: number;
} | undefined): AssistantMessage['usage'] {
  usage ??= {};
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const totalTokens = usage.totalTokens ?? input + output;
  const reasoning = usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    reported: {
      input: usage.inputTokens !== undefined,
      output: usage.outputTokens !== undefined,
      totalTokens: usage.totalTokens !== undefined || (usage.inputTokens !== undefined && usage.outputTokens !== undefined),
      cacheRead: (usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens) !== undefined,
      cacheWrite: usage.inputTokenDetails?.cacheWriteTokens !== undefined,
      reasoning: (usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens) !== undefined,
    },
    ...((usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens) !== undefined ? { reasoning } : {}),
    cost: { ...EMPTY_TOKEN_USAGE.cost },
  };
}

type CapturedThinkingPart = {
  text: string;
  providerOptions?: ThinkingProviderOptions;
};

/** Signatures to keep on a thinking block: Anthropic signature/redactedData and Gemini thoughtSignature. */
function thinkingOptionsFromProviderMetadata(metadata: unknown): ThinkingProviderOptions | undefined {
  return mergeThinkingOptions(anthropicOptionsFromProviderMetadata(metadata), toolCallProviderOptions(metadata));
}

function anthropicOptionsFromProviderMetadata(
  metadata: unknown,
): ThinkingProviderOptions | undefined {
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

function mergeThinkingOptions(
  left: ThinkingProviderOptions | undefined,
  right: ThinkingProviderOptions | undefined,
): ThinkingProviderOptions | undefined {
  if (!left) return right;
  if (!right) return left;
  const out: Record<string, Record<string, string>> = {};
  for (const source of [left, right]) {
    for (const [key, value] of Object.entries(source)) {
      if (value) out[key] = { ...(out[key] ?? {}), ...(value as Record<string, string>) };
    }
  }
  return out as ThinkingProviderOptions;
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
      const providerOptions = thinkingOptionsFromProviderMetadata(part.providerMetadata);
      if (!text && !providerOptions?.anthropic?.redactedData) return undefined;
      return { text, providerOptions };
    })
    .filter((part): part is CapturedThinkingPart => part !== undefined);

  if (fromSdk.length > 0) return fromSdk;

  const text = input.streamedText || input.finalText || '';
  return text ? [{ text }] : [];
}

type CapturedToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  inputError?: ToolCallInputError;
  providerOptions?: ToolCallProviderOptions;
};

/** Keep the Gemini function-call signature (`providerMetadata.google.thoughtSignature`) for replay. */
export function toolCallProviderOptions(metadata: unknown): ToolCallProviderOptions | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const out: ToolCallProviderOptions = {};
  for (const key of ['google', 'vertex']) {
    const signature = (metadata as Record<string, { thoughtSignature?: unknown } | undefined>)[key]?.thoughtSignature;
    if (typeof signature === 'string' && signature) out[key] = { thoughtSignature: signature };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildAssistantMessage(
  model: Model,
  text: string,
  thinkingParts: readonly CapturedThinkingPart[],
  toolCalls: CapturedToolCall[],
  finish: FinishOutcome,
  usage: AssistantMessage['usage'],
  textOptions?: ToolCallProviderOptions,
): AssistantMessage {
  // Stream order: thinking, then the answer text, then tool calls (S6).
  const content: AssistantMessage['content'] = [];

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

  if (text) content.push({ type: 'text', text, ...(textOptions ? { providerOptions: textOptions } : {}) });

  for (const call of toolCalls) {
    content.push({
      type: 'toolCall',
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      ...(call.inputError ? { inputError: call.inputError } : {}),
      ...(call.providerOptions ? { providerOptions: call.providerOptions } : {}),
    });
  }
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: finish.stopReason,
    ...(finish.errorMessage ? { errorMessage: finish.errorMessage } : {}),
    timestamp: Date.now(),
  };
}

type ProviderOpts = Record<string, Record<string, JSONValue>>;

function buildProviderOptions(
  model: Pick<Model, 'sdk' | 'providerOptions' | 'compat'>,
  cacheOpts: ProviderOpts | undefined,
  hasDeferredTools: boolean,
): ProviderOpts | undefined {
  const sdk = model.sdk;
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

  // OpenAI-protocol endpoints without the `developer` role (reasoning models default to it).
  if (sdk === 'openai' && model.compat?.supportsDeveloperRole === false) {
    opts.openai = { ...(opts.openai ?? {}), systemMessageMode: 'system' };
  }

  // Provider config (e.g. Gemini safetySettings / thinkingConfig) layers on top, per provider key.
  for (const [key, value] of Object.entries(model.providerOptions ?? {})) {
    opts[key] = { ...(opts[key] ?? {}), ...value };
  }

  return Object.keys(opts).length > 0 ? opts : undefined;
}

/** providerOptions keys that already pick a reasoning setting for that provider. */
const EXPLICIT_REASONING_KEYS = ['thinkingConfig', 'thinking', 'reasoningEffort', 'effort'];

/**
 * StreamOptions.thinkingLevel (or the provider's `thinkingLevel`) → AI SDK `reasoning`.
 * Skipped for MiniMax (forced adaptive) and when providerOptions already set reasoning.
 */
export function resolveReasoningOption(
  model: Pick<Model, 'sdk' | 'providerOptions' | 'thinkingLevel'>,
  level: ThinkingLevel | undefined,
): 'none' | 'low' | 'medium' | 'high' | undefined {
  const effective = level ?? model.thinkingLevel;
  if (!effective || model.sdk === 'minimax') return undefined;
  const explicit = Object.values(model.providerOptions ?? {})
    .some((options) => EXPLICIT_REASONING_KEYS.some((key) => options?.[key] !== undefined));
  if (explicit) return undefined;
  return effective === 'off' ? 'none' : effective;
}

function withReasoning(model: Model, options: StreamOptions | undefined): { reasoning?: 'none' | 'low' | 'medium' | 'high' } {
  const reasoning = resolveReasoningOption(model, options?.thinkingLevel);
  return reasoning ? { reasoning } : {};
}

function isGoogleSdk(sdk: string | undefined): boolean {
  return sdk === 'google';
}

/**
 * OpenAI chat refusal text (`delta.refusal` in a raw stream chunk, `message.refusal`
 * in a response body). The AI SDK drops it, which turned refusals into empty replies.
 */
function openAiRefusalText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const choice = (raw as { choices?: Array<{ delta?: { refusal?: unknown }; message?: { refusal?: unknown } } | null> })
    .choices?.[0];
  const value = choice?.delta?.refusal ?? choice?.message?.refusal;
  return typeof value === 'string' ? value : '';
}

const REFUSAL_REASON_MAX_CHARS = 200;

/** Finish override for a refusal with no text or tool calls: surface it as a content-filter stop. */
function refusalFinish(
  refusal: string,
  hasText: boolean,
  hasToolCalls: boolean,
): { finishReason: 'content-filter'; rawFinishReason: string } | undefined {
  const reason = refusal.trim();
  if (!reason || hasText || hasToolCalls) return undefined;
  const clipped = reason.length > REFUSAL_REASON_MAX_CHARS ? `${reason.slice(0, REFUSAL_REASON_MAX_CHARS)}…` : reason;
  return { finishReason: 'content-filter', rawFinishReason: `refusal: ${clipped}` };
}

function reasoningDeltaText(part: { text?: unknown; delta?: unknown }): string {
  if (typeof part.text === 'string' && part.text.length > 0) return part.text;
  if (typeof part.delta === 'string' && part.delta.length > 0) return part.delta;
  return '';
}

export function createAiSdkStreamFn(runtime: LlmApiRuntime): StreamFn {
  return (model, requestedContext, requestedOptions) => {
    const promptStructured = Boolean(requestedOptions?.outputSchema) && structuredOutputMode(model) === 'prompt';
    const context = promptStructured ? withStructuredOutputInstruction(requestedContext, requestedOptions!.outputSchema!) : requestedContext;
    const options = promptStructured ? { ...requestedOptions, outputSchema: undefined } : requestedOptions;
    return createAssistantMessageEventStream(async (push) => {
      const languageModel = runtime.resolveLanguageModel(model.provider, model.id);
      if (!languageModel) {
        throw new Error(`No LanguageModel registered for provider ${model.provider}`);
      }

      const cacheCtx = resolvePromptCacheApplyInput(
        isStreamPromptCacheEnabled(options?.promptCache),
        model.sdk,
        options,
        model.compat,
      );
      const toolNames = createToolNameCodec((context.tools ?? []).map((t) => t.name), model.sdk);
      const { system: systemText, systemParts, messages } = contextToAiSdkPrompt(
        context,
        model.input.filter((kind): kind is 'image' | 'audio' | 'video' | 'file' => kind !== 'text'),
        {
        ensureToolCallReasoning: shouldEnsureToolCallReasoning(model),
        sdk: model.sdk,
        toolNames,
        },
      );
      const system = wrapSystemForPromptCache(systemText, cacheCtx, systemParts);
      const tools = applyPromptCacheToTools(llmToolsToAiSdk(context.tools, { sdk: model.sdk, toolNames }), cacheCtx);
      const hasDeferredTools = context.tools?.some(t => t.deferLoading) === true;
      const cacheOpts = buildPromptCacheProviderOptions(cacheCtx);
      const providerOptions = buildProviderOptions(model, cacheOpts, hasDeferredTools);

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

      const captureRefusal = model.sdk === 'openai';
      const captureStructuredText = model.sdk === 'minimax' && Boolean(options?.outputSchema);
      let structuredResponseText = '';
      let structuredResponseHasTool = false;
      const result = streamText({
        model: languageModel,
        system,
        messages: applyPromptCacheToMessages(messages, cacheCtx),
        onLanguageModelCallStart: options?.onRequest ? event => observeModelRequest(options.onRequest, event, options.outputSchema) : undefined,
        tools,
        toolChoice: tools ? 'auto' : undefined,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens ?? model.maxTokens,
        abortSignal: options?.signal,
        ...(options?.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
        providerOptions,
        ...withReasoning(model, options),
        output: buildStructuredOutputSpec(options?.outputSchema),
        // Gemini reports a blocked prompt only in a candidate-less chunk, OpenAI a refusal
        // only in `delta.refusal`; the SDK drops both.
        ...(isGoogleSdk(model.sdk) || captureRefusal || captureStructuredText ? { includeRawChunks: true } : {}),
        // Provider-config stall timeouts (firstChunkTimeoutMs / chunkTimeoutMs); abort as TimeoutError.
        ...(model.streamTimeout ? { timeout: model.streamTimeout } : {}),
      });
      let refusal = '';

      let text = '';
      let rawBlockReason: string | undefined;
      let thinking = '';
      let streamedThinkingOptions: ThinkingProviderOptions | undefined;
      let textSignature: ToolCallProviderOptions | undefined;
      const toolCalls = new Map<string, CapturedToolCall>();
      const toolInputBuffers = new Map<string, string>();

      for await (const part of result.fullStream) {
        if (captureRefusal && part.type === 'raw') refusal += openAiRefusalText(part.rawValue);
        if (part.type === 'text-delta') {
          text += part.text;
          textSignature = toolCallProviderOptions(part.providerMetadata) ?? textSignature;
          if (part.text) push({ type: 'text_delta', text: part.text });
        } else if (part.type === 'reasoning-delta') {
          const chunk = reasoningDeltaText(part);
          if (chunk) {
            thinking += chunk;
            push({ type: 'thinking_delta', thinking: chunk });
          }
          streamedThinkingOptions = mergeThinkingOptions(
            streamedThinkingOptions,
            thinkingOptionsFromProviderMetadata(part.providerMetadata),
          );
        } else if (part.type === 'tool-input-start') {
          toolInputBuffers.set(part.id, '');
        } else if (part.type === 'tool-input-delta') {
          const prev = toolInputBuffers.get(part.id) ?? '';
          toolInputBuffers.set(part.id, prev + part.delta);
        } else if (part.type === 'tool-call') {
          const { arguments: args, inputError } = toolCallInput(part, toolInputBuffers.get(part.toolCallId));
          const signed = toolCallProviderOptions(part.providerMetadata);
          const name = toolNames.fromWire(part.toolName);
          toolCalls.set(part.toolCallId, {
            id: part.toolCallId,
            name,
            arguments: args,
            ...(inputError ? { inputError } : {}),
            ...(signed ? { providerOptions: signed } : {}),
          });
          push({
            type: 'toolcall_delta',
            toolCall: { id: part.toolCallId, name, arguments: args },
          });
        } else if (part.type === 'raw') {
          if (captureStructuredText) {
            structuredResponseText += anthropicTextDelta(part.rawValue);
            structuredResponseHasTool ||= anthropicStartsTool(part.rawValue);
          }
          rawBlockReason ??= promptBlockReason({ google: part.rawValue });
        } else if (part.type === 'error') {
          throw streamPartError(part.error);
        }
      }

      const final = await result;
      options?.onResponse?.(final.response);

      const structured = await readStructuredOutput(final, Boolean(options?.outputSchema), toolCalls.size > 0,
        structuredResponseHasTool ? '' : structuredResponseText);
      const finalText = await final.text;
      const finalReasoning = await Promise.resolve(final.reasoningText).catch(() => '');
      const finalReasoningParts = await Promise.resolve(final.reasoning).catch(() => undefined);
      const finishReason = await final.finishReason;
      const finalUsage = await final.usage;

      const calls = [...toolCalls.values()];
      const answerText = structured !== undefined
        ? formatStructuredAsAssistantText(structured)
        : (text || finalText);
      const resolvedText = promptStructured && calls.length === 0 ? normalizePromptStructuredText(answerText) : answerText;
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
      const refused = refusalFinish(refusal, Boolean(resolvedText.trim()), calls.length > 0);
      const assistant = buildAssistantMessage(
        model,
        resolvedText,
        thinkingParts,
        calls,
        resolveFinish({
          finishReason: refused?.finishReason ?? finishReason,
          rawFinishReason: refused?.rawFinishReason
            ?? await Promise.resolve(final.rawFinishReason).catch(() => undefined),
          providerMetadata: rawBlockReason
            ? { google: { promptFeedback: { blockReason: rawBlockReason } } }
            : await Promise.resolve(final.providerMetadata).catch(() => undefined),
          hasText: Boolean(resolvedText.trim()),
          hasToolCalls: calls.length > 0,
        }),
        usageFromAiSdk(finalUsage),
        structured === undefined ? textSignature : undefined,
      );
      return assistant;
    });
  };
}

/** Non-streaming complete via AI SDK generateText (legacy service.chat paths). */
export async function generateTextViaAiSdk(
  languageModel: LanguageModel,
  model: Model,
  requestedContext: Context,
  requestedOptions?: StreamOptions,
): Promise<AssistantMessage> {
  const promptStructured = Boolean(requestedOptions?.outputSchema) && structuredOutputMode(model) === 'prompt';
  const context = promptStructured ? withStructuredOutputInstruction(requestedContext, requestedOptions!.outputSchema!) : requestedContext;
  const options = promptStructured ? { ...requestedOptions, outputSchema: undefined } : requestedOptions;
  const cacheCtx = resolvePromptCacheApplyInput(
    isStreamPromptCacheEnabled(options?.promptCache),
    model.sdk,
    options,
    model.compat,
  );
  const toolNames = createToolNameCodec((context.tools ?? []).map((t) => t.name), model.sdk);
  const { system: systemText, systemParts, messages } = contextToAiSdkPrompt(
    context,
    model.input.filter((kind): kind is 'image' | 'audio' | 'video' | 'file' => kind !== 'text'),
    {
    ensureToolCallReasoning: shouldEnsureToolCallReasoning(model),
    sdk: model.sdk,
    toolNames,
    },
  );
  const system = wrapSystemForPromptCache(systemText, cacheCtx, systemParts);
  const tools = applyPromptCacheToTools(llmToolsToAiSdk(context.tools, { sdk: model.sdk, toolNames }), cacheCtx);
  const hasDeferredTools = context.tools?.some(t => t.deferLoading) === true;
  const providerOptions = buildProviderOptions(model, buildPromptCacheProviderOptions(cacheCtx), hasDeferredTools);

  let result;
  try {
    result = await generateText({
      model: languageModel,
      system,
      messages: applyPromptCacheToMessages(messages, cacheCtx),
      onLanguageModelCallStart: options?.onRequest ? event => observeModelRequest(options.onRequest, event, options.outputSchema) : undefined,
      tools,
      toolChoice: tools ? 'auto' : undefined,
      temperature: options?.temperature,
      maxOutputTokens: options?.maxTokens ?? model.maxTokens,
      abortSignal: options?.signal,
      ...(options?.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      providerOptions,
      ...withReasoning(model, options),
      output: buildStructuredOutputSpec(options?.outputSchema),
      // Keep provider text/refusal blocks that structured-output conversion may discard.
      ...(model.sdk === 'openai' || model.sdk === 'minimax' ? { include: { responseBody: true } } : {}),
    });
  } catch (error) {
    // generateText validates before returning, unlike streamText's output getter.
    if (options?.outputSchema && NoObjectGeneratedError.isInstance(error)) {
      const raw = model.sdk === 'minimax' ? anthropicResponseText(error.response?.body) : '';
      const structured = await readStructuredOutput(undefined, true, false, raw);
      const text = formatStructuredAsAssistantText(structured);
      return buildAssistantMessage(model, text, [], [], resolveFinish({
        finishReason: error.finishReason ?? 'error', hasText: Boolean(text.trim()), hasToolCalls: false,
      }), usageFromAiSdk(error.usage));
    }
    throw error;
  }

  const structured = await readStructuredOutput(result, Boolean(options?.outputSchema), result.toolCalls.length > 0,
    model.sdk === 'minimax' && options?.outputSchema ? anthropicResponseText(result.response.body) : '');
  const toolCalls: CapturedToolCall[] = result.toolCalls.map((call) => {
    const signed = toolCallProviderOptions(call.providerMetadata);
    const { arguments: args, inputError } = toolCallInput(call);
    return {
      id: call.toolCallId,
      name: toolNames.fromWire(call.toolName),
      arguments: args,
      ...(inputError ? { inputError } : {}),
      ...(signed ? { providerOptions: signed } : {}),
    };
  });

  const answerText = structured !== undefined ? formatStructuredAsAssistantText(structured) : result.text;
  const text = promptStructured && toolCalls.length === 0 ? normalizePromptStructuredText(answerText) : answerText;
  const refused = model.sdk === 'openai'
    ? refusalFinish(openAiRefusalText(result.response.body), Boolean(text.trim()), toolCalls.length > 0)
    : undefined;
  return buildAssistantMessage(
    model,
    text,
    resolveThinkingParts({
      streamedText: '',
      finalText: result.reasoningText ?? '',
      reasoningParts: result.reasoning,
    }),
    toolCalls,
    resolveFinish({
      finishReason: refused?.finishReason ?? result.finishReason,
      rawFinishReason: refused?.rawFinishReason ?? result.rawFinishReason,
      providerMetadata: result.providerMetadata,
      hasText: Boolean(text.trim()),
      hasToolCalls: toolCalls.length > 0,
    }),
    usageFromAiSdk(result.usage),
    structured === undefined ? textSignatureFromContent(result.content) : undefined,
  );
}

/** Last Gemini signature on a text part of a generateText result. */
function textSignatureFromContent(content: ReadonlyArray<{ type: string; providerMetadata?: unknown }> | undefined): ToolCallProviderOptions | undefined {
  let signed: ToolCallProviderOptions | undefined;
  for (const part of content ?? []) {
    if (part.type === 'text') signed = toolCallProviderOptions(part.providerMetadata) ?? signed;
  }
  return signed;
}
