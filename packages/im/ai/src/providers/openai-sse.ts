/**
 * OpenAI-compatible SSE → chat.completion 聚合（部分代理在 stream:false 时仍返回 SSE）
 */

import type {
  ChatCompletionChoice,
  ChatCompletionResponse,
  ChatMessage,
  ToolCall,
  Usage,
} from '../types.js';

export function isOpenAISseBody(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('data:') || /(?:^|\n)data:\s*\{/.test(trimmed);
}

export function parseOpenAIChatCompletionBody(text: string): ChatCompletionResponse {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new SyntaxError('Empty response body');
  }
  if (!isOpenAISseBody(trimmed)) {
    return JSON.parse(trimmed) as ChatCompletionResponse;
  }
  return aggregateOpenAISseToChatCompletion(trimmed);
}

/** SSE 行解析用宽松类型（部分代理在 SSE 里混入完整 chat.completion） */
interface LooseOpenAISseEvent {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: ChatMessage;
    delta?: Partial<ChatMessage>;
    finish_reason?: ChatCompletionChoice['finish_reason'];
  }>;
  usage?: Usage;
}

export function aggregateOpenAISseToChatCompletion(sseText: string): ChatCompletionResponse {
  const chunks: LooseOpenAISseEvent[] = [];
  for (const line of sseText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    try {
      chunks.push(JSON.parse(data) as LooseOpenAISseEvent);
    } catch {
      /* skip malformed chunk */
    }
  }
  if (chunks.length === 0) {
    throw new SyntaxError('SSE body has no parseable chunks');
  }

  const first = chunks[0];
  if (first.object === 'chat.completion') {
    const choice = first.choices?.[0];
    if (choice?.message) {
      return first as ChatCompletionResponse;
    }
  }

  let id = '';
  let model = '';
  let created = 0;
  let usage: Usage | undefined;
  let content = '';
  let reasoningContent = '';
  let role: ChatMessage['role'] = 'assistant';
  let finishReason: ChatCompletionChoice['finish_reason'] = null;
  const toolCallsByIndex = new Map<number, ToolCall>();

  for (const chunk of chunks) {
    id = chunk.id || id;
    model = chunk.model || model;
    created = chunk.created || created;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta as Partial<ChatMessage> | undefined;
    if (!delta) continue;
    if (delta.role) role = delta.role;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = (tc as ToolCall & { index?: number }).index ?? 0;
        let existing = toolCallsByIndex.get(idx);
        if (!existing) {
          existing = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          toolCallsByIndex.set(idx, existing);
        }
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls = toolCallsByIndex.size > 0
    ? [...toolCallsByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    : undefined;

  const message: ChatMessage = {
    role,
    content,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  };

  return {
    id: id || 'chatcmpl-sse-aggregated',
    object: 'chat.completion',
    created: created || Math.floor(Date.now() / 1000),
    model: model || 'unknown',
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason || (toolCalls ? 'tool_calls' : 'stop'),
    }],
    usage,
  };
}
