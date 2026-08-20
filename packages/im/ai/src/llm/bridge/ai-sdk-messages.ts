/**
 * pi Context ↔ AI SDK ModelMessage bridge (ADR 0018).
 */

import { type ModelMessage, type ToolSet, type UserModelMessage, tool } from 'ai';
import type { Context } from '../types/context.js';
import { isLlmAgentMessage, type AgentMessage, type AssistantMessage, type ToolResultMessage, type UserMessage } from '../types/agent-message.js';
import type { AnthropicThinkingProviderOptions, ThinkingContentBlock } from '../types/content-block.js';
import {
  DEFAULT_PROVIDER_MEDIA,
  filterMediaBlocksForProvider,
  mediaRefToInline,
  type ProviderMediaKind,
} from '../convert/media-blocks.js';

import { repairAgentMessagesForLlm } from '../repair-agent-messages.js';
import type { LlmTool } from '../types/tool.js';

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
  | { type: 'image'; image: string }
  | { type: 'file'; data: string; mediaType: string };

export type AiSdkMessageBridgeOptions = {
  readonly preRepaired?: boolean;
  /** openai-compatible CoT placeholder for tool_calls (DeepSeek-style). */
  readonly ensureToolCallReasoning?: boolean;
  /** Provider SDK id — gates Anthropic signed-thinking round-trip. */
  readonly sdk?: string;
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
      parts.push({ type: 'image', image: inline.value });
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
  providerOptions?: AnthropicThinkingProviderOptions;
};

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
    reasoningParts.push({ type: 'reasoning', text });
  }

  return reasoningParts;
}

function assistantToAiMessage(
  message: AssistantMessage,
  options?: AiSdkMessageBridgeOptions,
): ModelMessage {
  const textParts = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => ({ type: 'text' as const, text: b.text }));
  const reasoningParts = thinkingToReasoningParts(message, options);
  const toolCalls = message.content
    .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
    .map((b) => ({
      type: 'tool-call' as const,
      toolCallId: b.id,
      toolName: b.name,
      input: b.arguments,
    }));

  if (
    options?.ensureToolCallReasoning
    && !usesAnthropicReasoningProtocol(options.sdk)
    && toolCalls.length > 0
    && reasoningParts.length === 0
  ) {
    reasoningParts.push({ type: 'reasoning', text: TOOL_CALL_REASONING_PLACEHOLDER });
  }

  const content = [...textParts, ...reasoningParts, ...toolCalls];
  return {
    role: 'assistant',
    content: content.length > 0 ? content : '',
  };
}

function toolResultToAiMessage(message: ToolResultMessage): ModelMessage {
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
        toolName: message.toolName,
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
  for (const message of source) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'user') {
      out.push({ role: 'user', content: userBlocksToAiContent(message, mediaCapabilities) });
    } else if (message.role === 'assistant') {
      out.push(assistantToAiMessage(message, options));
    } else if (message.role === 'toolResult') {
      out.push(toolResultToAiMessage(message));
    }
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

export function llmToolsToAiSdk(tools: LlmTool[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const out: ToolSet = {};
  for (const llmTool of tools) {
    const base = tool({
      description: llmTool.description,
      inputSchema: llmTool.parameters,
    });
    if (llmTool.deferLoading) {
      out[llmTool.name] = {
        ...base,
        providerOptions: {
          anthropic: { deferLoading: true },
        },
      } as typeof base;
    } else {
      out[llmTool.name] = base;
    }
  }
  return out;
}
