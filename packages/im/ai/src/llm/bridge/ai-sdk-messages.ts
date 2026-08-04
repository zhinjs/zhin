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

function assistantToAiMessage(message: AssistantMessage): ModelMessage {
  const textParts = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => ({ type: 'text' as const, text: b.text }));
  const reasoningParts = message.content
    .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => ({ type: 'reasoning' as const, text: b.thinking }));
  const toolCalls = message.content
    .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
    .map((b) => ({
      type: 'tool-call' as const,
      toolCallId: b.id,
      toolName: b.name,
      input: b.arguments,
    }));

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
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of repairAgentMessagesForLlm(messages)) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'user') {
      out.push({ role: 'user', content: userBlocksToAiContent(message, mediaCapabilities) });
    } else if (message.role === 'assistant') {
      out.push(assistantToAiMessage(message));
    } else if (message.role === 'toolResult') {
      out.push(toolResultToAiMessage(message));
    }
  }
  return out;
}

export function contextToAiSdkPrompt(
  context: Context,
  mediaCapabilities: readonly ProviderMediaKind[] = DEFAULT_PROVIDER_MEDIA,
): {
  system?: string;
  messages: ModelMessage[];
} {
  const messages = agentMessagesToAiSdk(context.messages, mediaCapabilities);
  const system = context.systemPrompt.trim() || undefined;
  return { system, messages };
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
