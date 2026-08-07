/**
 * pi Context ↔ AI SDK ModelMessage bridge (ADR 0018).
 */

import { type ModelMessage, type ToolSet, type UserModelMessage, tool } from 'ai';
import type { Context } from '../types/context.js';
import { isLlmAgentMessage, type AgentMessage, type AssistantMessage, type ToolResultMessage, type UserMessage } from '../types/agent-message.js';
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
 */
export const TOOL_CALL_REASONING_PLACEHOLDER = '\u200b';

type AiSdkUserPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string }
  | { type: 'file'; data: string; mediaType: string };

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

function assistantToAiMessage(
  message: AssistantMessage,
  options?: { ensureToolCallReasoning?: boolean },
): ModelMessage {
  const textParts = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => ({ type: 'text' as const, text: b.text }));
  const reasoningParts: Array<{ type: 'reasoning'; text: string }> = message.content
    .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => ({
      type: 'reasoning' as const,
      // Empty CoT must still round-trip as a non-empty string for openai-compatible convert.
      text: b.thinking || (options?.ensureToolCallReasoning ? TOOL_CALL_REASONING_PLACEHOLDER : ''),
    }))
    .filter((b) => b.text.length > 0);
  const toolCalls = message.content
    .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
    .map((b) => ({
      type: 'tool-call' as const,
      toolCallId: b.id,
      toolName: b.name,
      input: b.arguments,
    }));

  if (
    options?.ensureToolCallReasoning &&
    toolCalls.length > 0 &&
    reasoningParts.length === 0
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
  options?: { preRepaired?: boolean; ensureToolCallReasoning?: boolean },
): ModelMessage[] {
  const out: ModelMessage[] = [];
  const source = options?.preRepaired ? messages : repairAgentMessagesForLlm(messages);
  for (const message of source) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'user') {
      out.push({ role: 'user', content: userBlocksToAiContent(message, mediaCapabilities) });
    } else if (message.role === 'assistant') {
      out.push(assistantToAiMessage(message, {
        ensureToolCallReasoning: options?.ensureToolCallReasoning,
      }));
    } else if (message.role === 'toolResult') {
      out.push(toolResultToAiMessage(message));
    }
  }
  return out;
}

export function contextToAiSdkPrompt(
  context: Context,
  mediaCapabilities: readonly ProviderMediaKind[] = DEFAULT_PROVIDER_MEDIA,
  options?: { ensureToolCallReasoning?: boolean },
): {
  system?: string;
  messages: ModelMessage[];
} {
  const messages = agentMessagesToAiSdk(context.messages, mediaCapabilities, {
    preRepaired: context.preRepaired === true,
    ensureToolCallReasoning: options?.ensureToolCallReasoning,
  });
  const system = context.systemPrompt.trim() || undefined;
  return { system, messages };
}

/** Thinking-mode models that require reasoning_content round-trip on tool_calls. */
export function shouldEnsureToolCallReasoning(model: {
  reasoning?: boolean;
}): boolean {
  return model.reasoning === true;
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
