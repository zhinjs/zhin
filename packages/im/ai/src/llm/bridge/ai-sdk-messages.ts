/**
 * pi Context ↔ AI SDK ModelMessage bridge (ADR 0018).
 */

import { type AssistantContent, type JSONSchema7, type ModelMessage, type ToolSet, type UserModelMessage, jsonSchema, tool } from 'ai';
import type { Context } from '../types/context.js';
import { isLlmAgentMessage, type AgentMessage, type AssistantMessage, type ToolResultMessage, type UserMessage } from '../types/agent-message.js';
import type { AnthropicThinkingProviderOptions, ThinkingContentBlock, ThinkingProviderOptions, ToolCallProviderOptions } from '../types/content-block.js';
import {
  DEFAULT_PROVIDER_MEDIA,
  filterMediaBlocksForProvider,
  mediaRefToInline,
  type ProviderMediaKind,
} from '../convert/media-blocks.js';

import { repairAgentMessagesForLlm } from '../repair-agent-messages.js';
import type { LlmTool } from '../types/tool.js';
import { geminiCompatibleSchema } from '../json-schema-zod.js';
import { createToolNameCodec, type ToolNameCodec } from './tool-name-wire.js';

/**
 * DeepSeek thinking + tools requires `reasoning_content` on every assistant
 * message that had tool_calls. AI SDK openai-compatible omits the field when
 * reasoning text is empty; gateways (e.g. OpenCode Zen) sometimes strip CoT
 * from tool_call responses. A zero-width placeholder keeps the field present
 * so subsequent tool-loop requests are not rejected with 400.
 *
 * Do **not** use this for Anthropic-protocol SDKs (anthropic / minimax): they
 * require signed thinking blocks and treat unsigned reasoning as a warning.
 */
export const TOOL_CALL_REASONING_PLACEHOLDER = '\u200b';

type AiSdkUserPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: string; mediaType: string };

export type AiSdkMessageBridgeOptions = {
  readonly preRepaired?: boolean;
  /** openai-compatible CoT placeholder for tool_calls (DeepSeek-style). */
  readonly ensureToolCallReasoning?: boolean;
  /** Provider SDK id — gates Anthropic signed-thinking round-trip. */
  readonly sdk?: string;
  /**
   * Internal → wire tool-name mapping (see `createToolNameCodec`). Defaults to a
   * codec for `sdk`, so Gemini never sees an invalid function name in history.
   */
  readonly toolNames?: ToolNameCodec;
};

/** SDKs that convert messages via Anthropic prompt + signed thinking blocks. */
export function usesAnthropicReasoningProtocol(sdk?: string): boolean {
  return sdk === 'anthropic' || sdk === 'minimax';
}

function hasAnthropicThinkingMetadata(
  providerOptions: AnthropicThinkingProviderOptions | undefined,
): boolean {
  const anthropic = providerOptions?.anthropic;
  return typeof anthropic?.signature === 'string'
    || typeof anthropic?.redactedData === 'string';
}

function userBlocksToAiContent(
  message: UserMessage,
  mediaCapabilities: readonly ProviderMediaKind[],
): UserModelMessage['content'] {
  const parts: AiSdkUserPart[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    }
  }
  const { accepted, placeholders } = filterMediaBlocksForProvider(message.media, mediaCapabilities);
  for (const block of accepted) {
    const inline = mediaRefToInline(block.data.media)!;
    if (block.type === 'image') {
      // A file part with the real image/* type (the AI SDK `image` part is deprecated
      // and drops the MIME type, so providers had to sniff the bytes).
      const mediaType = inline.mimeType?.startsWith('image/') ? inline.mimeType : 'image';
      parts.push({ type: 'file', data: inline.value, mediaType });
    } else {
      // AI SDK 原生 file part：@ai-sdk/* 各自映射 provider 原生块
      parts.push({ type: 'file', data: inline.value, mediaType: inline.mimeType });
    }
  }
  for (const text of placeholders) {
    parts.push({ type: 'text', text });
  }
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].text;
  }
  return parts as UserModelMessage['content'];
}

type AiSdkReasoningPart = {
  type: 'reasoning';
  text: string;
  providerOptions?: ThinkingProviderOptions;
};

/** Only the Gemini signature keys of a stored providerOptions (for non-Anthropic replay). */
function googleSignatures(options: ThinkingProviderOptions | ToolCallProviderOptions | undefined): ToolCallProviderOptions | undefined {
  if (!options) return undefined;
  const out: ToolCallProviderOptions = {};
  for (const key of ['google', 'vertex'] as const) {
    const signature = (options as Record<string, { thoughtSignature?: string } | undefined>)[key]?.thoughtSignature;
    if (typeof signature === 'string' && signature) out[key] = { thoughtSignature: signature };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function thinkingToReasoningParts(
  message: AssistantMessage,
  options?: AiSdkMessageBridgeOptions,
): AiSdkReasoningPart[] {
  const anthropicProtocol = usesAnthropicReasoningProtocol(options?.sdk);
  const thinkingBlocks = message.content.filter(
    (b): b is ThinkingContentBlock => b.type === 'thinking',
  );

  const reasoningParts: AiSdkReasoningPart[] = [];
  for (const block of thinkingBlocks) {
    if (anthropicProtocol) {
      // Unsigned thinking (e.g. MiniMax adaptive CoT) is display-only — never re-send.
      if (!hasAnthropicThinkingMetadata(block.providerOptions)) continue;
      reasoningParts.push({
        type: 'reasoning',
        text: block.thinking,
        providerOptions: block.providerOptions,
      });
      continue;
    }

    const text = block.thinking
      || (options?.ensureToolCallReasoning ? TOOL_CALL_REASONING_PLACEHOLDER : '');
    if (!text) continue;
    const signed = googleSignatures(block.providerOptions);
    reasoningParts.push({ type: 'reasoning', text, ...(signed ? { providerOptions: signed } : {}) });
  }

  return reasoningParts;
}

function assistantToAiMessage(
  message: AssistantMessage,
  options: AiSdkMessageBridgeOptions | undefined,
  toolNames: ToolNameCodec,
): ModelMessage {
  const textParts = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => {
      const signed = googleSignatures(b.providerOptions);
      return { type: 'text' as const, text: b.text, ...(signed ? { providerOptions: signed } : {}) };
    });
  const reasoningParts = thinkingToReasoningParts(message, options);
  const toolCalls = message.content
    .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
    .map((b) => ({
      type: 'tool-call' as const,
      toolCallId: b.id,
      toolName: toolNames.toWire(b.name),
      input: b.arguments,
      ...(b.providerOptions ? { providerOptions: b.providerOptions } : {}),
    }));

  if (
    options?.ensureToolCallReasoning
    && !usesAnthropicReasoningProtocol(options.sdk)
    && toolCalls.length > 0
    && reasoningParts.length === 0
  ) {
    reasoningParts.push({ type: 'reasoning', text: TOOL_CALL_REASONING_PLACEHOLDER });
  }

  // Reasoning first: Anthropic requires a thinking + tool_use turn to open with the
  // signed thinking block, and both Anthropic and Gemini stream thoughts before the answer.
  // Older stored messages kept text before thinking, so order on replay, not only on capture.
  const content = [...reasoningParts, ...textParts, ...toolCalls];
  return {
    role: 'assistant',
    content: (content.length > 0 ? content : '') as AssistantContent,
  };
}

function toolResultToAiMessage(message: ToolResultMessage, toolNames: ToolNameCodec): ModelMessage {
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: message.toolCallId,
        toolName: toolNames.toWire(message.toolName),
        output: {
          type: message.isError ? 'error-text' : 'text',
          value: text || (message.isError ? 'Error' : ''),
        },
      },
    ],
  };
}

export function agentMessagesToAiSdk(
  messages: AgentMessage[],
  mediaCapabilities: readonly ProviderMediaKind[] = DEFAULT_PROVIDER_MEDIA,
  options?: AiSdkMessageBridgeOptions,
): ModelMessage[] {
  const out: ModelMessage[] = [];
  const source = options?.preRepaired ? messages : repairAgentMessagesForLlm(messages);
  const toolNames = options?.toolNames ?? createToolNameCodec([], options?.sdk);
  for (const message of source) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'user') {
      out.push({ role: 'user', content: userBlocksToAiContent(message, mediaCapabilities) });
    } else if (message.role === 'assistant') {
      out.push(assistantToAiMessage(message, options, toolNames));
    } else if (message.role === 'toolResult') {
      out.push(toolResultToAiMessage(message, toolNames));
    }
  }
  return options?.sdk === 'google' ? orderGeminiFunctionCallTurns(out) : out;
}

type AssistantModelMessage = Extract<ModelMessage, { role: 'assistant' }>;

function hasToolCallPart(message: ModelMessage): message is AssistantModelMessage {
  return message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some((part) => part.type === 'tool-call');
}

function assistantParts(message: AssistantModelMessage): Exclude<AssistantContent, string> {
  return typeof message.content === 'string'
    ? message.content ? [{ type: 'text', text: message.content }] : []
    : message.content;
}

/** Gemini function calls must follow a user or function-response turn, including imported histories. */
function orderGeminiFunctionCallTurns(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    if (!hasToolCallPart(message)) {
      out.push(message);
      continue;
    }
    let call = message;
    let previous = out.at(-1);
    while (previous?.role === 'assistant' && !hasToolCallPart(previous)) {
      const parts = assistantParts(call);
      call = {
        ...call,
        content: [
          ...parts.filter((part) => part.type === 'reasoning'),
          ...assistantParts(previous),
          ...parts.filter((part) => part.type !== 'reasoning'),
        ],
      };
      out.pop();
      previous = out.at(-1);
    }
    if (previous?.role !== 'user' && previous?.role !== 'tool') {
      out.push({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
    }
    out.push(call);
  }
  return out;
}

export function contextToAiSdkPrompt(
  context: Context,
  mediaCapabilities: readonly ProviderMediaKind[] = DEFAULT_PROVIDER_MEDIA,
  options?: AiSdkMessageBridgeOptions,
): {
  system?: string;
  messages: ModelMessage[];
} {
  const messages = agentMessagesToAiSdk(context.messages, mediaCapabilities, {
    preRepaired: context.preRepaired === true,
    ensureToolCallReasoning: options?.ensureToolCallReasoning,
    sdk: options?.sdk,
    toolNames: options?.toolNames,
  });
  const system = context.systemPrompt.trim() || undefined;
  return { system, messages };
}

/**
 * Thinking-mode models that need openai-compatible `reasoning_content` round-trip
 * on tool_calls. Anthropic-protocol SDKs are excluded — they need signatures, not placeholders.
 */
export function shouldEnsureToolCallReasoning(model: {
  reasoning?: boolean;
  sdk?: string;
}): boolean {
  if (model.reasoning !== true) return false;
  if (usesAnthropicReasoningProtocol(model.sdk)) return false;
  return true;
}

/**
 * The tool input schema as the provider sees it. A tool with `inputJsonSchema`
 * is sent as written (Gemini gets untyped leaves typed, see `geminiCompatibleSchema`)
 * and validated with its zod `parameters`; a zod-only tool is converted by the AI SDK.
 */
function toolInputSchema(llmTool: LlmTool, sdk: string | undefined) {
  if (!llmTool.inputJsonSchema) return llmTool.parameters;
  const wire = sdk === 'google' ? geminiCompatibleSchema(llmTool.inputJsonSchema) : llmTool.inputJsonSchema;
  return jsonSchema<Record<string, unknown>>(wire as JSONSchema7, {
    validate: (value) => {
      const parsed = llmTool.parameters.safeParse(value);
      return parsed.success
        ? { success: true, value: value as Record<string, unknown> }
        : { success: false, error: parsed.error };
    },
  });
}

/**
 * LlmTool[] → AI SDK ToolSet keyed by wire names. For Gemini, names that break its
 * function-name rule (e.g. a leading digit) are rewritten via `toolNames`; pass the
 * same codec to the message bridge and map returned tool calls back with `fromWire`.
 */
export function llmToolsToAiSdk(
  tools: LlmTool[] | undefined,
  options?: { sdk?: string; toolNames?: ToolNameCodec },
): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const toolNames = options?.toolNames ?? createToolNameCodec(tools.map((t) => t.name), options?.sdk);
  const out: ToolSet = {};
  for (const llmTool of [...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const base = tool({
      description: llmTool.description,
      inputSchema: toolInputSchema(llmTool, options?.sdk),
    });
    if (llmTool.deferLoading) {
      out[toolNames.toWire(llmTool.name)] = {
        ...base,
        providerOptions: {
          anthropic: { deferLoading: true },
        },
      } as typeof base;
    } else {
      out[toolNames.toWire(llmTool.name)] = base;
    }
  }
  return out;
}
