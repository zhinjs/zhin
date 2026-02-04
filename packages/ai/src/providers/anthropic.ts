/**
 * @zhin.js/ai - Anthropic Provider
 * 支持 Claude 系列模型
 */

import { BaseProvider } from './base.js';
import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
  ToolDefinition,
  ContentPart,
} from '../types.js';

export interface AnthropicConfig extends ProviderConfig {
  anthropicVersion?: string;
}

/**
 * Anthropic API 格式转换
 */
function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: any[];
} {
  let system: string | undefined;
  const anthropicMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string' 
        ? msg.content 
        : msg.content.map(p => p.type === 'text' ? p.text : '').join('');
      continue;
    }

    if (msg.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }],
      });
      continue;
    }

    let content: any;
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else {
      content = msg.content.map((part: ContentPart) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part.type === 'image_url') {
          // Anthropic 需要 base64 格式
          const url = part.image_url.url;
          if (url.startsWith('data:')) {
            const [meta, data] = url.split(',');
            const mediaType = meta.match(/data:(.*?);/)?.[1] || 'image/png';
            return {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data },
            };
          }
          return {
            type: 'image',
            source: { type: 'url', url },
          };
        }
        return { type: 'text', text: '' };
      });
    }

    // 处理 tool_calls
    if (msg.tool_calls?.length) {
      const toolUseContent = msg.tool_calls.map(tc => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      }));
      
      if (typeof content === 'string' && content) {
        content = [{ type: 'text', text: content }, ...toolUseContent];
      } else if (Array.isArray(content)) {
        content = [...content, ...toolUseContent];
      } else {
        content = toolUseContent;
      }
    }

    anthropicMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }

  return { system, messages: anthropicMessages };
}

/**
 * 转换工具定义
 */
function toAnthropicTools(tools?: ToolDefinition[]): any[] | undefined {
  if (!tools?.length) return undefined;
  
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

/**
 * 转换 Anthropic 响应为 OpenAI 格式
 */
function fromAnthropicResponse(response: any): ChatCompletionResponse {
  const content: ContentPart[] = [];
  const toolCalls: any[] = [];

  for (const block of response.content || []) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const textContent = content
    .filter(c => c.type === 'text')
    .map(c => (c as { type: 'text'; text: string }).text)
    .join('');

  return {
    id: response.id,
    object: 'chat.completion',
    created: Date.now(),
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    }],
    usage: {
      prompt_tokens: response.usage?.input_tokens || 0,
      completion_tokens: response.usage?.output_tokens || 0,
      total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    },
  };
}

export class AnthropicProvider extends BaseProvider {
  name = 'anthropic';
  models = [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ];

  private baseUrl: string;
  private anthropicVersion: string;

  constructor(config: AnthropicConfig = {}) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.anthropicVersion = config.anthropicVersion || '2023-06-01';
  }

  protected async fetch<T>(url: string, options: RequestInit & { json?: any } = {}): Promise<T> {
    const { json, ...fetchOptions } = options;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': this.anthropicVersion,
      ...this.config.headers,
      ...(options.headers as Record<string, string>),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await globalThis.fetch(url, {
        ...fetchOptions,
        headers,
        body: json ? JSON.stringify(json) : fetchOptions.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API Error (${response.status}): ${error}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { system, messages } = toAnthropicMessages(request.messages);
    
    const anthropicRequest: any = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || 4096,
    };

    if (system) {
      anthropicRequest.system = system;
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    if (request.top_p !== undefined) {
      anthropicRequest.top_p = request.top_p;
    }

    if (request.stop) {
      anthropicRequest.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }

    const tools = toAnthropicTools(request.tools);
    if (tools) {
      anthropicRequest.tools = tools;
    }

    const response = await this.fetch<any>(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      json: anthropicRequest,
    });

    return fromAnthropicResponse(response);
  }

  async *chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const { system, messages } = toAnthropicMessages(request.messages);
    
    const anthropicRequest: any = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || 4096,
      stream: true,
    };

    if (system) {
      anthropicRequest.system = system;
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    const tools = toAnthropicTools(request.tools);
    if (tools) {
      anthropicRequest.tools = tools;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': this.anthropicVersion,
    };

    const response = await globalThis.fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(anthropicRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API Error (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageId = '';
    let model = request.model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            
            if (event.type === 'message_start') {
              messageId = event.message?.id || '';
              model = event.message?.model || model;
            } else if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                yield {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Date.now(),
                  model,
                  choices: [{
                    index: 0,
                    delta: { content: event.delta.text },
                    finish_reason: null,
                  }],
                };
              }
            } else if (event.type === 'message_delta') {
              yield {
                id: messageId,
                object: 'chat.completion.chunk',
                created: Date.now(),
                model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: event.delta?.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
                }],
                usage: event.usage ? {
                  prompt_tokens: event.usage.input_tokens || 0,
                  completion_tokens: event.usage.output_tokens || 0,
                  total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                } : undefined,
              };
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }
}
