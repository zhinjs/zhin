/**
 * @zhin.js/ai - Ollama Provider
 * 支持本地 Ollama 模型
 */

import { Logger } from '@zhin.js/logger';
import { BaseProvider } from './base.js';
import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
  ToolDefinition,
} from '../types.js';

const logger = new Logger(null, 'Ollama');

export interface OllamaConfig extends ProviderConfig {
  host?: string;
  models?: string[];
  /** Ollama 上下文窗口大小（token 数），默认 32768。影响多轮对话和技能指令的保持能力 */
  num_ctx?: number;
}

/**
 * 转换消息格式
 */
function toOllamaMessages(messages: ChatMessage[]): any[] {
  return messages.map(msg => {
    let content: string;
    const images: string[] = [];

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else {
      content = msg.content
        .filter(p => p.type === 'text')
        .map(p => (p as { type: 'text'; text: string }).text)
        .join('');
      
      for (const part of msg.content) {
        if (part.type === 'image_url') {
          const url = part.image_url.url;
          if (url.startsWith('data:')) {
            // 提取 base64 数据
            const base64 = url.split(',')[1];
            if (base64) images.push(base64);
          }
        }
      }
    }

    const result: any = {
      role: msg.role === 'tool' ? 'user' : msg.role,
      content,
    };

    if (images.length > 0) {
      result.images = images;
    }

    return result;
  });
}

/**
 * 转换工具定义
 */
function toOllamaTools(tools?: ToolDefinition[]): any[] | undefined {
  if (!tools?.length) return undefined;

  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

export class OllamaProvider extends BaseProvider {
  name = 'ollama';
  models: string[];
  contextWindow: number;
  capabilities = { vision: true, streaming: true, toolCalling: true, thinking: true };

  private host: string;
  private numCtx: number;

  constructor(config: OllamaConfig = {}) {
    super(config);
    this.host = config.host || config.baseUrl || 'http://localhost:11434';
    this.numCtx = config.contextWindow ?? config.num_ctx ?? 32768;
    this.contextWindow = this.numCtx;
    this.models = config.models?.length ? config.models : [
      'llama3.3',
      'llama3.2',
      'llama3.1',
      'qwen2.5',
      'qwen2.5-coder',
      'deepseek-r1',
      'deepseek-v3',
      'mistral',
      'mixtral',
      'phi4',
      'gemma2',
    ];
    logger.debug(`初始化完成, host: ${this.host}`);
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const messages = toOllamaMessages(request.messages);
    
    logger.debug(`请求 ${request.model}, 消息: ${messages.length}`);
    
    const ollamaRequest: any = {
      model: request.model,
      messages,
      stream: false,
      options: {
        num_ctx: this.numCtx,
      },
    };

    // think 参数：控制 qwen3 等模型的思考模式
    if (request.think !== undefined) {
      ollamaRequest.think = request.think;
    }

    if (request.temperature !== undefined) {
      ollamaRequest.options.temperature = request.temperature;
    }

    if (request.top_p !== undefined) {
      ollamaRequest.options.top_p = request.top_p;
    }

    if (request.max_tokens !== undefined) {
      ollamaRequest.options.num_predict = request.max_tokens;
    }

    const tools = toOllamaTools(request.tools);
    if (tools) {
      ollamaRequest.tools = tools;
    }

    const startTime = Date.now();
    
    const response = await this.fetch<any>(`${this.host}/api/chat`, {
      method: 'POST',
      json: ollamaRequest,
    });
    
    logger.debug(`响应耗时: ${Date.now() - startTime}ms, 工具调用: ${response.message?.tool_calls?.length || 0}`);

    // 转换响应格式
    const toolCalls = response.message?.tool_calls?.map((tc: any, i: number) => ({
      id: `call_${i}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: JSON.stringify(tc.function.arguments),
      },
    }));

    return {
      id: `ollama-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.message?.content || '',
          tool_calls: toolCalls?.length ? toolCalls : undefined,
        },
        finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: response.prompt_eval_count || 0,
        completion_tokens: response.eval_count || 0,
        total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      },
    };
  }

  async *chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const messages = toOllamaMessages(request.messages);
    
    const ollamaRequest: any = {
      model: request.model,
      messages,
      stream: true,
      options: {
        num_ctx: this.numCtx,
      },
    };

    if (request.think !== undefined) {
      ollamaRequest.think = request.think;
    }

    if (request.temperature !== undefined) {
      ollamaRequest.options.temperature = request.temperature;
    }

    if (request.top_p !== undefined) {
      ollamaRequest.options.top_p = request.top_p;
    }

    const response = await globalThis.fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API Error (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const id = `ollama-${Date.now()}`;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);
          
          yield {
            id,
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: data.model || request.model,
            choices: [{
              index: 0,
              delta: data.done 
                ? {} 
                : { content: data.message?.content || '' },
              finish_reason: data.done ? 'stop' : null,
            }],
            usage: data.done ? {
              prompt_tokens: data.prompt_eval_count || 0,
              completion_tokens: data.eval_count || 0,
              total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            } : undefined,
          };
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.fetch<{ models: { name: string }[] }>(
        `${this.host}/api/tags`
      );
      return response.models.map(m => m.name);
    } catch {
      return this.models;
    }
  }

  /**
   * 拉取模型
   */
  async pullModel(model: string): Promise<void> {
    await this.fetch(`${this.host}/api/pull`, {
      method: 'POST',
      json: { name: model },
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await globalThis.fetch(`${this.host}/api/tags`);
      return true;
    } catch {
      return false;
    }
  }
}
