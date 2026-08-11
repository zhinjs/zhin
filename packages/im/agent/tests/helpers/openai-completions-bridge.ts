/**
 * Test-only OpenAI ChatCompletion bridge — moved out of `@zhin.js/ai` 公共面
 * （原 llm/providers/openai-completions.ts + llm/convert/openai-bridge.ts 的
 * 测试专用部分）。唯一消费者是 agent 测试 mock（mock-llm-api.ts 把 mock
 * provider.chat 桥成 llm stream）；生产传输恒走 ai-sdk，勿在生产引用本文件。
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  createAssistantMessageEventStream,
  repairAgentMessagesForLlm,
  isLlmAgentMessage,
  EMPTY_TOKEN_USAGE,
  DEFAULT_PROVIDER_MEDIA,
  filterMediaBlocksForProvider,
  mediaRefToInline,
  formatRedactedJson,
  type AgentMessage,
  type AssistantMessage,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatMessage,
  type ContentPart,
  type Context,
  type LlmTool,
  type Model,
  type ProviderMediaKind,
  type StreamFn,
  type ToolDefinition,
  type ToolResultMessage,
  type UserMessage,
} from '@zhin.js/ai';

const llmContextLogger = getLogger('LLM');

/**
 * 测试 mock 面的最小契约（OpenAI wire chat）。
 * 生产 `AIProvider` 已无 chat —— 本类型仅服务 mock 桥，不是生产扩展点。
 */
export interface ChatCompletionsMockProvider {
  readonly name: string;
  readonly models: readonly string[];
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export function createOpenAiCompletionsStreamFn(
  getResolver: () => ((alias: string) => ChatCompletionsMockProvider | undefined) | undefined,
): StreamFn {
  return (model, context, options) => {
    return createAssistantMessageEventStream(async (push) => {
      const provider = getResolver()?.(model.provider);
      if (!provider || typeof provider.chat !== 'function') {
        throw new Error(`Provider ${model.provider} does not support chat()`);
      }

      const request = contextToChatCompletionRequest(model, context, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      });
      llmContextLogger.debug(formatCompact({
        op: 'context_request',
        provider: model.provider,
        model: model.id,
        api: model.api,
        messages: formatRedactedJson(request.messages),
        tools: request.tools?.length ?? 0,
      }));

      const response = await provider.chat(request);

      const assistant = chatCompletionToAssistantMessage(response, model);
      const text = assistant.content.find((b) => b.type === 'text');
      if (text && text.type === 'text' && text.text) {
        push({ type: 'text_delta', text: text.text });
      }
      return assistant;
    });
  };
}

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
    // Empty CoT still needs a non-empty field for DeepSeek tool-loop round-trip.
    msg.reasoning_content = thinking.thinking || '​';
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

function agentMessagesToOpenAi(
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

function llmToolsToOpenAi(tools: LlmTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as ToolDefinition['function']['parameters'],
    },
  }));
}

function contextToChatCompletionRequest(
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
  return 'stop';
}

function chatCompletionToAssistantMessage(
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
    let args: Record<string, unknown>;
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
