/**
 * pi Context ↔ AI SDK ModelMessage bridge (ADR 0018).
 */

import { type ModelMessage, type ToolSet, type UserModelMessage, tool } from 'ai';
import type { Context } from '../types/context.js';
import { isLlmAgentMessage, type AgentMessage, type AssistantMessage, type ToolResultMessage, type UserMessage } from '../types/agent-message.js';

import { repairAgentMessagesForLlm } from '../repair-agent-messages.js';
import type { LlmTool } from '../types/tool.js';

function userBlocksToAiContent(blocks: UserMessage['content']): UserModelMessage['content'] {
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      let image: string;
      if (block.data.startsWith('data:') || block.data.startsWith('http://') || block.data.startsWith('https://')) {
        image = block.data;
      } else {
        image = `data:${block.mimeType};base64,${block.data}`;
      }
      parts.push({ type: 'image', image });
    }
  }
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].text;
  }
  return parts;
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

export function agentMessagesToAiSdk(messages: AgentMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of repairAgentMessagesForLlm(messages)) {
    if (!isLlmAgentMessage(message)) continue;
    if (message.role === 'user') {
      out.push({ role: 'user', content: userBlocksToAiContent(message.content) });
    } else if (message.role === 'assistant') {
      out.push(assistantToAiMessage(message));
    } else if (message.role === 'toolResult') {
      out.push(toolResultToAiMessage(message));
    }
  }
  return out;
}

export function contextToAiSdkPrompt(context: Context): {
  system?: string;
  messages: ModelMessage[];
} {
  const messages = agentMessagesToAiSdk(context.messages);
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
