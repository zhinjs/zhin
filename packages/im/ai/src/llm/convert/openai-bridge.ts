/**
 * pi Context ↔ OpenAI ChatCompletion bridge (ADR 0009 migration layer).
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ContentPart,
  ToolDefinition,
} from '../../types.js';
import type { Context } from '../types/context.js';
import { isLlmAgentMessage, EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage, type ToolResultMessage, type UserMessage } from '../types/agent-message.js';
import {
  DEFAULT_PROVIDER_MEDIA,
  filterMediaBlocksForProvider,
  mediaRefToInline,
  type ProviderMediaKind,
} from './media-blocks.js';

import type { LlmTool } from '../types/tool.js';
import type { Model } from '../types/model.js';

import { repairAgentMessagesForLlm } from '../repair-agent-messages.js';

function userBlocksToOpenAiContent(
  message: UserMessage,
  mediaCapabilities: readonly ProviderMediaKind[],
): string | ContentPart[] {
  const parts: ContentPart[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    }
  }
  const { accepted, placeholders } = filterMediaBlocksForProvider(message.media, mediaCapabilities);
  for (const block of accepted) {
    if (block.type !== 'image') continue;
    const inline = mediaRefToInline(block.data.media)!;
    parts.push({ type: 'image_url', image_url: { url: inline.value } });
  }
  for (const text of placeholders) {
    parts.push({ type: 'text', text });
  }
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].text;
  }
  return parts;
}

function assistantToOpenAiMessage(message: AssistantMessage): ChatMessage {
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls = message.content
    .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
    .map((b) => ({
      id: b.id,
      type: 'function' as const,
      function: {
        name: b.name,
        arguments: JSON.stringify(b.arguments),
      },
    }));
  const msg: ChatMessage = { role: 'assistant', content: text };
  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls;
  }
  const thinking = message.content.find((b) => b.type === 'thinking');
  if (thinking && thinking.type === 'thinking') {
    msg.reasoning_content = thinking.thinking;
  }
  return msg;
}

function toolResultToOpenAiMessage(message: ToolResultMessage): ChatMessage {
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return {
    role: 'tool',
    tool_call_id: message.toolCallId,
    content: text || (message.isError ? 'Error' : ''),
  };
}

export function agentMessagesToOpenAi(
  messages: AgentMessage[],
  mediaCapabilities: readonly ProviderMediaKind[] = DEFAULT_PROVIDER_MEDIA,
  options?: { preRepaired?: boolean },
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const source = options?.preRepaired ? messages : repairAgentMessagesForLlm(messages);
  for (const message of source) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'user') {
      out.push({ role: 'user', content: userBlocksToOpenAiContent(message, mediaCapabilities) });
    } else if (message.role === 'assistant') {
      out.push(assistantToOpenAiMessage(message));
    } else if (message.role === 'toolResult') {
      out.push(toolResultToOpenAiMessage(message));
    }
  }
  return out;
}

export function llmToolsToOpenAi(tools: LlmTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as ToolDefinition['function']['parameters'],
    },
  }));
}

export function contextToChatCompletionRequest(
  model: Model,
  context: Context,
  options?: { temperature?: number; maxTokens?: number },
): ChatCompletionRequest {
  const messages: ChatMessage[] = [];
  if (context.systemPrompt.trim()) {
    messages.push({ role: 'system', content: context.systemPrompt });
  }
  messages.push(...agentMessagesToOpenAi(context.messages, DEFAULT_PROVIDER_MEDIA, {
    preRepaired: context.preRepaired === true,
  }));
  return {
    model: model.id,
    messages,
    tools: context.tools?.length ? llmToolsToOpenAi(context.tools) : undefined,
    tool_choice: context.tools?.length ? 'auto' : undefined,
    temperature: options?.temperature,
    max_tokens: options?.maxTokens ?? model.maxTokens,
  };
}

function mapStopReason(
  reason: string | null | undefined,
  hasToolCalls: boolean,
): AssistantMessage['stopReason'] {
  if (hasToolCalls || reason === 'tool_calls') return 'toolCalls';
  if (reason === 'length') return 'length';
  if (reason === 'stop') return 'stop';
  return 'stop';
}

export function chatCompletionToAssistantMessage(
  response: ChatCompletionResponse,
  model: Model,
): AssistantMessage {
  const choice = response.choices[0];
  const message = choice?.message;
  const content: AssistantMessage['content'] = [];
  const text = typeof message?.content === 'string' ? message.content : '';
  const reasoningRaw = message?.reasoning_content ?? message?.reasoning;
  const reasoning = typeof reasoningRaw === 'string' ? reasoningRaw : undefined;
  if (text) {
    content.push({ type: 'text', text });
  } else if (reasoning && !(message?.tool_calls?.length)) {
    content.push({ type: 'text', text: String(reasoning) });
  }
  if (reasoning) {
    content.push({ type: 'thinking', thinking: String(reasoning) });
  }
  const toolCalls = message?.tool_calls ?? [];
  for (const call of toolCalls) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      args = {};
    }
    content.push({
      type: 'toolCall',
      id: call.id,
      name: call.function.name,
      arguments: args,
    });
  }
  const usage = response.usage;
  const tokenUsage = usage
    ? {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: usage.total_tokens,
        cost: { ...EMPTY_TOKEN_USAGE.cost },
      }
    : { ...EMPTY_TOKEN_USAGE };

  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: tokenUsage,
    stopReason: mapStopReason(choice?.finish_reason, toolCalls.length > 0),
    timestamp: Date.now(),
  };
}

export function assistantText(message: AssistantMessage): string {
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (text.trim()) return text;
  const hasToolCalls = message.content.some((b) => b.type === 'toolCall');
  if (hasToolCalls) return text;
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('');
}
